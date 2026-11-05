import { installAuditRetentionRoutes } from './auditRetention.js';
import { databasePage } from './databasePage.js';
import { databaseConfiguration, needsDatabaseSetup } from './storage/configuration.js';
import { listResponse } from './listQuery.js';
import { auditContext } from './recordAudit.js';
import { auditDetails } from './auditDetails.js';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { requireRole, helpdeskScope } from './helpdeskRoles.js';

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

export function installAuditRoutes(app, store) {
  installAuditRetentionRoutes(app, store);
  app.post('/api/helpdesk/exports', async (request, response) => {
    const { format, count, source } = request.body || {};
    if (
      Object.keys(request.body || {}).some((key) => !['format', 'count', 'source'].includes(key)) ||
      !['csv', 'json'].includes(format) ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 10000 ||
      typeof source !== 'string' ||
      !/^\/api\/[a-zA-Z0-9_/-]{1,180}$/.test(source)
    )
      return response.status(400).json({ error: 'Invalid export record.' });
    await store.collection('governanceAudit').insertOne({
      _id: randomUUID(),
      ...helpdeskScope(request.helpdeskUser),
      actorId: request.helpdeskUser.id,
      role: request.helpdeskUser.role,
      actualRole: request.helpdeskUser.actualRole || request.helpdeskUser.role,
      isImpersonating: request.helpdeskUser.isImpersonating === true,
      method: 'EXPORT',
      action: `export.${format}`,
      target: source,
      recordCount: count,
      startedAt: new Date(),
      completedAt: new Date(),
      outcome: 'completed',
    });
    response.json({ recorded: true });
  });
  const auditProjection = { ownerId: 0, workspaceId: 0 };
  app.get('/api/helpdesk/audit/workflows', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const q = request.query.q || '';
    if (typeof q !== 'string' || q.length > 200)
      return response.status(400).json({ error: 'Invalid workflow search.' });
    const filter = { ...helpdeskScope(request.helpdeskUser) };
    if (q.trim())
      filter.name = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const rows = await store
      .collection('helpdeskWorkflows')
      .find(filter, { projection: { name: 1 } })
      .sort({ name: 1 })
      .limit(100)
      .toArray();
    response.json(rows.map((item) => ({ value: String(item._id), label: item.name })));
  });
  async function auditRecord(user, id) {
    requireRole(user, ['admin']);
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return null;
    return store
      .collection('governanceAudit')
      .findOne({ ...helpdeskScope(user), _id: id }, { projection: auditProjection });
  }
  app.get('/api/helpdesk/audit/:id', async (request, response) => {
    const record = await auditRecord(request.helpdeskUser, request.params.id);
    if (!record) return response.status(404).json({ error: 'Audit record not found.' });
    response.json({ id: String(record._id), ...record });
  });
  app.get('/api/helpdesk/audit/:id/events', async (request, response) => {
    const record = await auditRecord(request.helpdeskUser, request.params.id);
    if (!record) return response.status(404).json({ error: 'Audit record not found.' });
    const group = record.requestAuditId || record._id;
    const filter = {
      ...helpdeskScope(request.helpdeskUser),
      $or: [
        { _id: group },
        { requestAuditId: group },
        { rootAuditId: record.rootAuditId || group },
        ...(record.workflowRunId ? [{ workflowRunId: record.workflowRunId }] : []),
        ...(record.sourceChatId && record.responseId
          ? [{ sourceChatId: record.sourceChatId, responseId: record.responseId }]
          : []),
        ...(record.resourceId ? [{ target: record.target, resourceId: record.resourceId }] : []),
      ],
    };
    const records = await store
      .collection('governanceAudit')
      .find(filter, { projection: auditProjection })
      .sort({ startedAt: 1, _id: 1 })
      .limit(10001)
      .toArray();
    if (records.length > 10000)
      return response.status(422).json({
        error:
          'This record has too many related events. Use the Audit report to narrow the date range.',
      });
    response.json(
      listResponse(
        request,
        records.map(({ _id, ...item }) => ({ id: String(_id), ...item })),
        {
          Time: 'startedAt',
          Action: 'action',
          Tool: 'toolName',
          Outcome: 'outcome',
          Fields: (item) => (item.changedFields || []).join(', '),
          Version: 'versionAfter',
        },
      ),
    );
  });
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
        Workflow: 'workflowName',
        Trigger: 'triggerLabel',
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
      const until = request.query.until ? new Date(request.query.until) : null;
      if (until && (!Number.isFinite(until.getTime()) || until > new Date()))
        return response.status(400).json({ error: 'Invalid audit cutoff.' });
      const filter = {
        ...helpdeskScope(request.helpdeskUser),
        startedAt: {
          $gte: new Date((until?.getTime() || Date.now()) - days * 86400000),
          ...(until ? { $lte: until } : {}),
        },
      };
      if (request.query.workflowId) {
        if (
          typeof request.query.workflowId !== 'string' ||
          !ObjectId.isValid(request.query.workflowId)
        )
          return response.status(400).json({ error: 'Choose a valid workflow.' });
        const id = request.query.workflowId;
        const associations = await store
          .collection('helpdeskWorkflowConversations')
          .find(
            { ...helpdeskScope(request.helpdeskUser), workflowId: id },
            { projection: { chatId: 1 } },
          )
          .limit(1000)
          .toArray();
        filter.$and = [
          {
            $or: [
              { workflowId: id },
              { target: { $regex: `/workflows/${id}(?:/|$)` } },
              { sourceChatId: { $in: associations.map((item) => item.chatId) } },
            ],
          },
        ];
      }
      if (request.query.triggerType) {
        if (
          ![
            'admin-chat',
            'support-chat',
            'request-submission',
            'workflow-step',
            'approval-decision',
            'workflow-configuration',
            'record-update',
            'api-request',
          ].includes(request.query.triggerType)
        )
          return response.status(400).json({ error: 'Choose a valid trigger.' });
        filter.triggerType = request.query.triggerType;
      }
      if (q.trim()) {
        const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
          'actorId',
          'action',
          'target',
          'outcome',
          'role',
          'method',
          'workflowName',
          'workflowId',
          'workflowRunId',
          'triggerLabel',
          'triggerType',
        ].map((key) => ({
          [key]: { $regex: escaped, $options: 'i' },
        }));
      }
      const result = await databasePage(store, [{ name: 'governanceAudit', filter }], {
        sortField: columns[sort],
        sortType: sort === 'Time' ? 'date' : sort === 'Version' ? 'number' : 'text',
        direction,
        page,
        pageSize,
        tieDirection: 'desc',
        projection: auditProjection,
      });
      const { rows, total, page: currentPage } = result;
      const associations = await store
        .collection('helpdeskWorkflowConversations')
        .find(
          {
            ...helpdeskScope(request.helpdeskUser),
            chatId: { $in: rows.map((item) => item.sourceChatId).filter(Boolean) },
          },
          { projection: { chatId: 1, workflowId: 1 } },
        )
        .toArray();
      for (const row of rows)
        row.workflowId ||= associations.find(
          (item) => item.chatId === row.sourceChatId,
        )?.workflowId;
      const workflowIds = [
        ...new Set(
          rows
            .map((item) => item.workflowId)
            .filter((id) => typeof id === 'string' && ObjectId.isValid(id)),
        ),
      ];
      const workflows = await store
        .collection('helpdeskWorkflows')
        .find(
          {
            ...helpdeskScope(request.helpdeskUser),
            _id: { $in: workflowIds.map((id) => new ObjectId(id)) },
          },
          { projection: { name: 1 } },
        )
        .toArray();
      for (const row of rows)
        row.workflowName ||= workflows.find((item) => String(item._id) === row.workflowId)?.name;
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
