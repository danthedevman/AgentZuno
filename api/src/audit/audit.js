import { databaseConfiguration, needsDatabaseSetup } from '../storage/configuration.js';

import { auditContext } from '../records/recordAudit.js';
import { auditDetails } from './auditDetails.js';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';

export function installAuditMiddleware(app, store, auth, options = {}) {
  app.locals.auditPending = new Set();
  const track = (operation) => {
    app.locals.auditPending.add(operation);
    operation
      .catch(() => console.error('Audit response could not be recorded.'))
      .finally(() => app.locals.auditPending.delete(operation));
  };
  app.use('/api', async (request, response, next) => {
    request.user = await auth.currentUser(request);
    const path = request.path;
    const isPublicRead = request.method === 'GET' && ['/site', '/auth/session'].includes(path);
    if (needsDatabaseSetup() && !options.forceStorage) {
      if (request.method === 'GET' && ['/site', '/auth/session', '/portal'].includes(path))
        return next();
      return response.status(503).json({
        error: 'Complete database setup before signing in or registering.',
        setupRequired: true,
      });
    }
    if (isPublicRead || (!options.forceStorage && !databaseConfiguration())) return next();
    // Never retain query strings, headers, request/response bodies, tokens, or model prompts.
    const target = path.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 240);
    const details = auditDetails({
      triggerType: /workflow-conversations/.test(path)
        ? 'admin-chat'
        : /\/decisions$/.test(path)
          ? 'approval-decision'
          : /\/form$/.test(path)
            ? 'request-submission'
            : /\/workflows(?:\/|$)/.test(path) && request.method !== 'GET'
              ? 'workflow-configuration'
              : 'api-request',
      triggerLabel: `${request.method} ${target}`,
      workflowId:
        typeof request.body?.workflowId === 'string' && ObjectId.isValid(request.body.workflowId)
          ? request.body.workflowId
          : path.match(/\/workflows\/([a-f0-9]{24})(?:\/|$)/)?.[1],
    });
    const auditId = randomUUID();
    try {
      await store.collection('governanceAudit').insertOne({
        _id: auditId,
        ownerId: request.user?.id || null,
        workspaceId: request.user?.workspaceId || null,
        actorType: request.user ? (request.user.isDemo ? 'demo' : 'account') : 'anonymous',
        method: request.method,
        target,
        ...details,
        startedAt: new Date(),
        outcome: 'started',
      });
    } catch {
      return response.status(503).json({ error: 'Audit storage is unavailable. Please retry.' });
    }
    response.setHeader('X-Audit-Id', auditId);
    let isRecorded = false;
    const sendJson = response.json.bind(response);
    response.json = async (body) => {
      const status = response.statusCode;
      try {
        await store.collection('governanceAudit').updateOne(
          { _id: auditId },
          {
            $set: {
              completedAt: new Date(),
              ...(!request.helpdeskUser && request.user
                ? {
                    ownerId: request.user.id,
                    workspaceId: request.user.workspaceId,
                    actorId: request.user.id,
                  }
                : {}),
              ...(request.helpdeskUser
                ? {
                    ownerId: request.helpdeskUser.helpdeskOwnerId,
                    workspaceId: request.helpdeskUser.workspaceId,
                    actorId: request.helpdeskUser.id,
                    role: request.helpdeskUser.role,
                    actualRole: request.helpdeskUser.actualRole || request.helpdeskUser.role,
                    isImpersonating: request.helpdeskUser.isImpersonating === true,
                  }
                : {}),
              ...(request.provisioningContext
                ? {
                    ownerId: request.provisioningContext.ownerId,
                    workspaceId: request.provisioningContext.workspaceId,
                    actorType: 'identity-provider',
                    actorId: 'scim',
                  }
                : {}),
              ...(response.locals.membershipChange
                ? { membershipChange: response.locals.membershipChange }
                : {}),
              statusCode: status,
              outcome: status >= 400 ? 'denied-or-failed' : 'completed',
            },
          },
        );
      } catch {
        response.status(503);
        return sendJson({
          error: 'Audit completion could not be confirmed. Check current state before retrying.',
          auditId,
        });
      }
      isRecorded = true;
      return sendJson(body);
    };
    response.once('finish', () => {
      if (isRecorded) return;
      track(
        store.collection('governanceAudit').updateOne(
          { _id: auditId, outcome: 'started' },
          {
            $set: {
              ...(request.helpdeskUser
                ? {
                    ownerId: request.helpdeskUser.helpdeskOwnerId,
                    workspaceId: request.helpdeskUser.workspaceId,
                    actorId: request.helpdeskUser.id,
                    role: request.helpdeskUser.role,
                    actualRole: request.helpdeskUser.actualRole || request.helpdeskUser.role,
                    isImpersonating: request.helpdeskUser.isImpersonating === true,
                  }
                : {}),
              ...(request.provisioningContext
                ? {
                    ownerId: request.provisioningContext.ownerId,
                    workspaceId: request.provisioningContext.workspaceId,
                    actorId: 'scim',
                    actorType: 'identity-provider',
                  }
                : {}),
              outcome: response.statusCode >= 400 ? 'denied-or-failed' : 'completed',
              statusCode: response.statusCode,
              completedAt: new Date(),
            },
          },
        ),
      );
    });
    response.once('close', () => {
      if (!response.writableFinished)
        track(
          store
            .collection('governanceAudit')
            .updateOne(
              { _id: auditId, outcome: 'started' },
              { $set: { outcome: 'interrupted', completedAt: new Date() } },
            ),
        );
    });
    auditContext.run({ request, auditId, details }, next);
  });
}

export async function auditOperation(store, actor, action, target, perform, details = {}) {
  const id = randomUUID();
  const parent = auditContext.getStore();
  const rootAuditId = parent?.rootAuditId || parent?.auditId || id;
  const contextDetails = auditDetails({ ...parent?.details, ...details });
  await store.collection('governanceAudit').insertOne({
    _id: id,
    ownerId: actor.ownerId || actor.id,
    actorId: actor.id,
    workspaceId: actor.workspaceId,
    actorType: 'worker',
    role: actor.role,
    actualRole: actor.actualRole || actor.role,
    isImpersonating: actor.isImpersonating === true,
    parentAuditId: parent?.auditId || null,
    rootAuditId,
    method: 'JOB',
    target,
    action,
    ...contextDetails,
    startedAt: new Date(),
    outcome: 'started',
  });
  try {
    const currentContext = auditContext.getStore();
    const result = await auditContext.run(
      {
        ...currentContext,
        auditId: id,
        rootAuditId,
        details: contextDetails,
        actorType: 'worker',
        request: currentContext?.request || {
          helpdeskUser: { ...actor, helpdeskOwnerId: actor.ownerId || actor.id },
        },
      },
      perform,
    );
    await store.collection('governanceAudit').updateOne(
      { _id: id },
      {
        $set: {
          completedAt: new Date(),
          outcome: result?.status === 'failed' ? 'denied-or-failed' : 'completed',
          ...(Number.isSafeInteger(result?.deletedCount)
            ? { deletedCount: result.deletedCount }
            : {}),
        },
      },
    );
    return result;
  } catch (error) {
    await store
      .collection('governanceAudit')
      .updateOne({ _id: id }, { $set: { completedAt: new Date(), outcome: 'denied-or-failed' } });
    throw error;
  }
}
