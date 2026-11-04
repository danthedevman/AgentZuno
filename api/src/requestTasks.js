import { ObjectId } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { helpdeskScope, requestScope, requireRequestOperator, deny } from './helpdeskRoles.js';
import { listResponse } from './listQuery.js';
import { requireExistingQueues } from './helpdeskQueues.js';

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
  async function update(user, requestId, id, input) {
    await parent(user, requestId, true);
    if (!ObjectId.isValid(id)) deny('Task not found.', 404);
    if (
      !input ||
      Object.keys(input).some((k) => !['status', 'version'].includes(k)) ||
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
    if (user.role === 'agent' && !(user.queues || []).includes(current.queueName))
      deny('This task is outside your assignment groups.');
    const result = await tasks().findOneAndUpdate(
      { ...helpdeskScope(user), requestId, _id: new ObjectId(id), version: input.version },
      {
        $set: {
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
  return { list, create, update, parent, createForWorkflow };
}
export function installRequestTaskRoutes(app, store) {
  const service = createRequestTasks(store);
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
