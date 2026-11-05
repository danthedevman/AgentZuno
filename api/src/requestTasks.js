import { ObjectId } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { helpdeskScope, requestScope, requireRequestOperator, requireRole, deny } from './helpdeskRoles.js';
import { listResponse } from './listQuery.js';
import { requireExistingQueues } from './helpdeskQueues.js';

export function taskAssignmentMatches(user) {
  return ['admin', 'agent', 'read-only'].includes(user.role)
    ? [{ queueName: { $in: user.queues || [] } }, { assignedToId: user.id }]
    : [{ _id: null }];
}
export async function taskInboxRecords(store, user) {
  const tasks = await store.collection('helpdeskTasks').find({
    ...helpdeskScope(user), $or: taskAssignmentMatches(user),
  }).toArray();
  const parents = await store.collection('helpdeskRequests').find({
    ...helpdeskScope(user), _id: { $in: tasks.map(task => new ObjectId(task.requestId)) },
    submissionState: { $ne: 'draft' },
  }, { projection: { _id: 1 } }).toArray();
  const parentIds = new Set(parents.map(parent => String(parent._id)));
  return tasks.filter(task => parentIds.has(task.requestId)).map(task => ({
    id: String(task._id), kind: 'task', taskId: String(task._id), requestId: task.requestId,
    title: task.title, description: task.description, status: task.status, queueName: task.queueName,
    assignedToId: task.assignedToId, assignedToName: task.assignedToName,
    number: 'Task', updatedAt: task.updatedAt, inboxNotice: 'Fulfillment Task',
    href: `/workspace/tasks/${task._id}`,
  }));
}
export function createRequestTasks(store) {
  const tasks = () => store.collection('helpdeskTasks');
  async function parent(user, id, writing = false) {
    if (!ObjectId.isValid(id)) deny('Request not found.', 404);
    const record = await store.collection('helpdeskRequests').findOne({
      ...requestScope(user),
      _id: new ObjectId(id),
    });
    if (!record) deny('Request not found.', 404);
    if (writing) {
      requireRequestOperator(user, record);
      if (record.status === 'resolved') deny('Reopen the request before changing tasks.', 409);
    }
    return record;
  }
  const safe = ({ _id, ownerId, workspaceId, ...record }) => ({ id: String(_id), ...record });
  async function list(user, requestId) {
    await parent(user, requestId);
    return (
      await tasks()
        .find({ ...helpdeskScope(user), requestId })
        .sort({ createdAt: 1 })
        .limit(200)
        .toArray()
    ).map(safe);
  }
  async function create(user, requestId, input, key = randomUUID()) {
    const request = await parent(user, requestId, true);
    return insert(user, request, input, key, request.queueName);
  }
  async function insert(user, request, input, key, queueName) {
    const requestId = String(request._id);
    if (
      !input ||
      Object.keys(input).some((k) => !['title', 'description'].includes(k)) ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 160 ||
      (input.description !== undefined &&
        (typeof input.description !== 'string' || input.description.length > 7000))
    )
      deny('Enter a task title up to 160 characters and details up to 7,000 characters.', 400);
    const scope = helpdeskScope(user);
    const id = new ObjectId(
      createHash('sha256')
        .update(JSON.stringify([scope, requestId, key]))
        .digest('hex')
        .slice(0, 24),
    );
    const existing = await tasks().findOne({ _id: id, ...scope });
    if (existing) return safe(existing);
    if ((await tasks().countDocuments({ ...scope, requestId })) >= 200)
      deny('A request supports up to 200 tasks.', 422);
    const now = new Date();
    const record = {
      _id: id,
      ...scope,
      requestId,
      title: input.title.trim(),
      description: input.description?.trim() || '',
      status: 'open',
      queueName,
      createdBy: user.id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(request.demoDatasetId
        ? { demo: true, demoDatasetId: request.demoDatasetId, demoIndustry: request.demoIndustry }
        : {}),
      events: [{ type: 'created', actorId: user.id, at: now }],
    };
    await tasks().updateOne({ _id: id, ...scope }, { $setOnInsert: record }, { upsert: true });
    return safe(await tasks().findOne({ _id: id, ...scope }));
  }
  function canManage(user, task) {
    return user.role === 'admin' || (user.role === 'agent' &&
      ((user.queues || []).includes(task.queueName) || task.assignedToId === user.id));
  }
  async function get(user, id) {
    if (!ObjectId.isValid(id)) deny('Task not found.', 404);
    const task = await tasks().findOne({ ...helpdeskScope(user), _id: new ObjectId(id) });
    if (!task) deny('Task not found.', 404);
    if (!canManage(user, task) && user.role !== 'read-only') await parent(user, task.requestId);
    const request = await store.collection('helpdeskRequests').findOne({
      ...helpdeskScope(user), _id: new ObjectId(task.requestId),
    });
    if (!request) deny('Task not found.', 404);
    let requestHref;
    try {
      await parent(user, task.requestId);
      requestHref = `/workspace/requests/${task.requestId}`;
    } catch (error) { if (![403, 404].includes(error.status)) throw error; }
    return { ...safe(task), permissions: { canEdit: canManage(user, task) && request.status !== 'resolved' },
      requestReference: { id: task.requestId, label: requestHref ? `${request.number || 'Request'} · ${request.title}` : 'Originating Request', href: requestHref } };
  }
  async function update(user, requestId, id, input) {
    requireRole(user, ['admin', 'agent']);
    const visible = await get(user, id);
    if (visible.requestId !== requestId) deny('Task not found.', 404);
    if (!visible.permissions.canEdit) deny('This task cannot be edited.');
    if (!ObjectId.isValid(id)) deny('Task not found.', 404);
    if (
      !input ||
      Object.keys(input).some((k) => !['title', 'description', 'assignedToId', 'status', 'version'].includes(k)) ||
      !['open', 'in-progress', 'closed'].includes(input.status) ||
      !Number.isInteger(input.version)
    )
      deny('Choose a valid task status and version.', 400);
    const current = await tasks().findOne({
      ...helpdeskScope(user),
      requestId,
      _id: new ObjectId(id),
    });
    if (!current) deny('Task not found.', 404);
    if (!canManage(user, current))
      deny('This task is outside your assignment groups.');
    const changes = {};
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160) deny('Enter a task title up to 160 characters.', 400);
      changes.title = input.title.trim();
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string' || input.description.length > 7000) deny('Enter details up to 7,000 characters.', 400);
      changes.description = input.description.trim();
    }
    if (input.assignedToId !== undefined) {
      if (typeof input.assignedToId !== 'string') deny('Choose an active support team member.', 400);
      const member = input.assignedToId && await store.collection('helpdeskMembers').findOne({
        ...helpdeskScope(user), userId: input.assignedToId, active: true, role: { $in: ['admin', 'agent'] }, queues: current.queueName,
      });
      if (input.assignedToId && !member) deny('Choose an active member of the assignment group.', 400);
      const account = member && await store.collection('users').findOne({ id: member.userId });
      changes.assignedToId = input.assignedToId;
      changes.assignedToName = account?.name || member?.email || '';
    }
    const result = await tasks().findOneAndUpdate(
      { ...helpdeskScope(user), requestId, _id: new ObjectId(id), version: input.version },
      {
        $set: {
          ...changes,
          status: input.status,
          updatedAt: new Date(),
          ...(input.status === 'closed' ? { closedBy: user.id, closedAt: new Date() } : {}),
        },
        ...(input.status !== 'closed' ? { $unset: { closedBy: '', closedAt: '' } } : {}),
        $inc: { version: 1 },
        $push: {
          events: {
            type: 'status-changed',
            status: input.status,
            actorId: user.id,
            at: new Date(),
          },
        },
      },
      { returnDocument: 'after' },
    );
    if (!result) deny('Task changed or is unavailable. Reload before saving.', 409);
    return safe(result);
  }
  async function createForWorkflow(run, stepId, input, actor) {
    const scope = helpdeskScope(actor);
    const declared = run.definition.steps.find(
      (step) => step.id === stepId && step.action === 'task.create',
    );
    if (
      scope.ownerId !== run.ownerId ||
      scope.workspaceId !== run.workspaceId ||
      actor.id !== run.actorId ||
      !declared ||
      declared.params.queueName !== input.queueName
    )
      deny('Task is outside the published workflow grant.');
    const request = await store.collection('helpdeskRequests').findOne({
      ...scope,
      _id: new ObjectId(run.requestId),
      requesterId: actor.id,
      submissionState: 'submitted',
      status: { $ne: 'resolved' },
    });
    if (!request) deny('Submitted request not found.', 404);
    await requireExistingQueues(store, actor, [input.queueName]);
    return insert(
      actor,
      request,
      { title: input.title, description: input.description },
      `${run._id}:${stepId}`,
      input.queueName,
    );
  }
  return { list, create, update, parent, createForWorkflow, get };
}
export function installRequestTaskRoutes(app, store) {
  const service = createRequestTasks(store);
  app.get('/api/helpdesk/tasks/:taskId', async (request, response) =>
    response.json(await service.get(request.helpdeskUser, request.params.taskId)));
  app.put('/api/helpdesk/tasks/:taskId', async (request, response) => {
    const task = await service.get(request.helpdeskUser, request.params.taskId);
    await service.update(request.helpdeskUser, task.requestId, task.id, request.body);
    response.json(await service.get(request.helpdeskUser, task.id));
  });
  app.get('/api/helpdesk/requests/:id/tasks', async (request, response) =>
    response.json(
      listResponse(request, await service.list(request.helpdeskUser, request.params.id), {
        Task: 'title',
        Status: 'status',
        Updated: 'updatedAt',
      }),
    ),
  );
  app.post('/api/helpdesk/requests/:id/tasks', async (request, response) =>
    response
      .status(201)
      .json(await service.create(request.helpdeskUser, request.params.id, request.body)),
  );
  app.put('/api/helpdesk/requests/:id/tasks/:taskId', async (request, response) =>
    response.json(
      await service.update(
        request.helpdeskUser,
        request.params.id,
        request.params.taskId,
        request.body,
      ),
    ),
  );
}
