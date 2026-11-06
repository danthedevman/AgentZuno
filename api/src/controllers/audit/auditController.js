import { databasePage } from '../../shared/databasePage.js';

import { listResponse } from '../../shared/listQuery.js';

import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { requireRole, helpdeskScope } from '../../identity/helpdeskRoles.js';

export function createAuditController(store) {
  const auditProjection = { ownerId: 0, workspaceId: 0 };
  async function auditRecord(user, id) {
    requireRole(user, ['admin']);
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return null;
    return store
      .collection('governanceAudit')
      .findOne({ ...helpdeskScope(user), _id: id }, { projection: auditProjection });
  }
  const postExports = async (request, response) => {
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
  };
  const getAuditWorkflows = async (request, response) => {
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
  };
  const getAuditId = async (request, response) => {
    const record = await auditRecord(request.helpdeskUser, request.params.id);
    if (!record) return response.status(404).json({ error: 'Audit record not found.' });
    response.json({ id: String(record._id), ...record });
  };
  const getAuditIdEvents = async (request, response) => {
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
  };
  const getAudit = async (request, response) => {
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
  };
  return { postExports, getAuditWorkflows, getAuditId, getAuditIdEvents, getAudit };
}
