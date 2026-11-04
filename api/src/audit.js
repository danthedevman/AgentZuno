import { listResponse } from './listQuery.js';
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
    const currentContext = auditContext.getStore();
    const result = await auditContext.run(
      {
        ...currentContext,
        auditId: id,
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
