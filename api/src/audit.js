import { auditContext } from './recordAudit.js';
import { randomUUID } from 'node:crypto';
import { requireRole, helpdeskScope } from './helpdeskRoles.js';

export function installAuditMiddleware(app, store, auth) {
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
    if (isPublicRead || !process.env.MONGODB_URI) return next();
    // Never retain query strings, headers, request/response bodies, tokens, or model prompts.
    const target = path.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 240);
    const auditId = randomUUID();
    try {
      await store.collection('governanceAudit').insertOne({
        _id: auditId,
        ownerId: request.user?.id || null,
        workspaceId: request.user?.workspaceId || null,
        actorType: request.user ? (request.user.isDemo ? 'demo' : 'account') : 'anonymous',
        method: request.method,
        target,
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
    auditContext.run({ request, auditId }, next);
  });
}

export function installAuditRoutes(app, store) {
  app.get('/api/helpdesk/audit', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    if (request.query.list === '1') {
      const columns = {
        Time: 'startedAt',
        Actor: 'actorId',
        Action: 'action',
        Target: 'target',
        Outcome: 'outcome',
        Role: 'role',
        Version: 'versionAfter',
      };
      const pageSize = Number(request.query.pageSize || 20),
        page = Number(request.query.page || 1),
        days = Number(request.query.days || 30);
      const sort = request.query.sort || 'Time',
        direction = request.query.direction || 'desc',
        q = request.query.q || '';
      if (
        !Object.hasOwn(columns, sort) ||
        !['asc', 'desc'].includes(direction) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 100000 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100 ||
        ![7, 30, 90].includes(days) ||
        typeof q !== 'string' ||
        q.length > 200
      )
        return response.status(400).json({ error: 'Invalid audit query.' });
      const filter = {
        ...helpdeskScope(request.helpdeskUser),
        startedAt: { $gte: new Date(Date.now() - days * 86400000) },
      };
      if (q.trim()) {
        const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = ['actorId', 'action', 'target', 'outcome', 'role', 'method'].map((key) => ({
          [key]: { $regex: escaped, $options: 'i' },
        }));
      }
      const total = await store.collection('governanceAudit').countDocuments(filter);
      const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const rows = await store
        .collection('governanceAudit')
        .find(filter, { projection: { ownerId: 0, workspaceId: 0 } })
        .sort({ [columns[sort]]: direction === 'asc' ? 1 : -1, _id: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize)
        .toArray();
      return response.json({
        rows: rows.map(({ _id, ...record }) => ({ id: String(_id), ...record })),
        total,
        page: currentPage,
        pageSize,
        hasNext: currentPage * pageSize < total,
      });
    }
    const records = await store
      .collection('governanceAudit')
      .find(helpdeskScope(request.helpdeskUser))
      .sort({ startedAt: -1, _id: -1 })
      .limit(100)
      .toArray();
    response.json(records.map(({ ownerId, workspaceId, ...record }) => record));
  });
}

export async function auditOperation(store, actor, action, target, perform) {
  const id = randomUUID();
  await store.collection('governanceAudit').insertOne({
    _id: id,
    ownerId: actor.ownerId || actor.id,
    actorId: actor.id,
    workspaceId: actor.workspaceId,
    actorType: 'worker',
    method: 'JOB',
    target,
    action,
    startedAt: new Date(),
    outcome: 'started',
  });
  try {
    const result = await perform();
    await store.collection('governanceAudit').updateOne(
      { _id: id },
      {
        $set: {
          completedAt: new Date(),
          outcome: result?.status === 'failed' ? 'denied-or-failed' : 'completed',
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
