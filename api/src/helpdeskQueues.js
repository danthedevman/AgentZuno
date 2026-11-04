import { requireCompatibleDemoReferences } from './demoReferences.js';
import { workspaceGroups } from './groups.js';
import { createHash } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
import { listResponse } from './listQuery.js';
const queueId = (user, name) =>
  createHash('sha256')
    .update(JSON.stringify([helpdeskScope(user), name]))
    .digest('hex')
    .slice(0, 24);
const text = (value, max, required = false) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required ? /[\x00-\x1f\x7f]/u : /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u).test(value) ||
    (required && !value.trim())
  )
    deny('Invalid queue details.', 400);
  return value.trim();
};
export async function existingQueueNames(store, user) {
  return (await workspaceGroups(store, user))
    .filter((group) => group.active !== false && group.assignmentEnabled)
    .map((group) => group.name);
}
export async function requireExistingQueues(store, user, names) {
  if (!names.length) return;
  const existing = await existingQueueNames(store, user);
  if (names.some((name) => !existing.includes(name)))
    deny('Choose an existing queue, or create it first.', 400);
}
export function installHelpdeskQueueRoutes(app, store) {
  async function list(user, realOnly = false) {
    requireRole(user, ['admin']);
    const scope = helpdeskScope(user);
    const [saved, members, config] = await Promise.all([
      store.collection('helpdeskQueues').find(scope).toArray(),
      store.collection('helpdeskMembers').find(scope).toArray(),
      store.collection('helpdeskSettings').findOne(scope),
    ]);
    const names = [
      ...new Set([
        ...saved.map((item) => item.name),
        ...members.flatMap((item) => item.queues || []),
        ...(config?.routing || []).map((item) => item.queueName),
      ]),
    ];
    const groups = await workspaceGroups(store, user);
    return groups
      .filter(
        (group) =>
          group.active !== false && group.assignmentEnabled && (!realOnly || !group.demoDatasetId),
      )
      .map((group) => {
        const name = group.name;
        const item = saved.find((record) => record.name === name);
        const agents = members.filter(
          (member) =>
            member.active &&
            ['admin', 'agent'].includes(member.role) &&
            member.queues?.includes(name),
        );
        return {
          id: queueId(user, name),
          groupId: String(group._id),
          name,
          description: item?.description || '',
          routingInstructions: item?.routingInstructions || '',
          agentIds: agents.map((member) => member.userId),
          agents: agents.map((member) => member.email),
          version: item?.version || 0,
          updatedAt: item?.updatedAt || null,
        };
      });
  }
  app.get('/api/helpdesk/queues', async (request, response) =>
    response.json(
      listResponse(
        request,
        await list(
          request.helpdeskUser,
          request.query.reference === '1' && request.query.includeDemo !== '1',
        ),
        {
          Queue: 'name',
          Description: 'description',
          Members: (item) => item.agents.join(', '),
          Updated: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : null),
        },
        { sort: 'Queue' },
      ),
    ),
  );
  app.get('/api/helpdesk/queues/:id', async (request, response) => {
    const item = (await list(request.helpdeskUser)).find((queue) => queue.id === request.params.id);
    if (!item) deny('Queue not found.', 404);
    response.json(item);
  });
  async function save(request, response) {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body;
    if (
      !input ||
      Object.keys(input).some(
        (key) =>
          !['name', 'description', 'routingInstructions', 'agentIds', 'version'].includes(key),
      ) ||
      !Array.isArray(input.agentIds) ||
      input.agentIds.length > 200 ||
      input.agentIds.some((id) => typeof id !== 'string' || id.length > 80)
    )
      deny('Invalid queue fields.', 400);
    const name = text(input.name, 80, true);
    const value = {
      name,
      description: text(input.description, 1000),
      routingInstructions: text(input.routingInstructions, 2000),
    };
    const scope = helpdeskScope(user);
    const id = queueId(user, name);
    const previous = (await list(user)).find((item) => item.id === request.params.id);
    if (request.params.id && (!previous || previous.name !== name))
      deny('Queue not found or its name changed.', 404);
    if (request.params.id && previous.version !== input.version)
      deny('Queue changed. Reload before saving.', 409);
    const agents = await store
      .collection('helpdeskMembers')
      .find({ ...scope, active: true, role: { $in: ['admin', 'agent'] } })
      .toArray();
    const groupSource = (await workspaceGroups(store, user)).find((item) => item.name === name);
    await requireCompatibleDemoReferences(store, user, groupSource, { agentIds: input.agentIds });
    const agentIds = [...new Set(input.agentIds)];
    if (agentIds.some((agentId) => !agents.some((member) => member.userId === agentId)))
      deny('Choose active Admins or Agents from this workspace.', 400);
    if (
      agents.some(
        (member) =>
          agentIds.includes(member.userId) &&
          !member.queues?.includes(name) &&
          member.queues?.length >= 30,
      )
    )
      deny('A member already has the maximum number of queues.', 400);
    const collection = store.collection('helpdeskQueues');
    const filter = { _id: id, ...scope };
    if (!previous?.version) {
      try {
        await collection.insertOne({
          ...filter,
          ...value,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (error) {
        if (error.code === 11000)
          deny('Queue already exists or changed. Reload before saving.', 409);
        throw error;
      }
    } else {
      const result = await collection.updateOne(
        { ...filter, version: input.version },
        { $set: { ...value, updatedAt: new Date() }, $inc: { version: 1 } },
      );
      if (!result.matchedCount) deny('Queue changed. Reload before saving.', 409);
    }
    // Queue names remain stable because request authorization uses the member's current queue grants.
    await store.collection('helpdeskMembers').updateMany(
      {
        ...scope,
        role: { $in: ['admin', 'agent'] },
        active: true,
        userId: { $in: agentIds },
        queues: { $ne: name },
      },
      { $addToSet: { queues: name }, $set: { updatedAt: new Date() }, $inc: { version: 1 } },
    );
    await store
      .collection('helpdeskMembers')
      .updateMany(
        { ...scope, userId: { $nin: agentIds }, queues: name },
        { $pull: { queues: name }, $set: { updatedAt: new Date() }, $inc: { version: 1 } },
      );
    const unified = (await workspaceGroups(store, user)).find((item) => item.name === name);
    if (unified)
      await store.collection('approvalGroups').updateOne(
        { ...scope, _id: unified._id },
        {
          $set: {
            userIds: [
              ...new Set([
                ...(unified.userIds || []).filter(
                  (id) => !agents.some((member) => member.userId === id),
                ),
                ...agentIds,
              ]),
            ],
            routingInstructions: value.routingInstructions,
            description: value.description,
            assignmentEnabled: true,
            active: true,
          },
          $inc: { version: 1 },
        },
      );
    response
      .status(request.params.id ? 200 : 201)
      .json((await list(user)).find((item) => item.id === id));
  }
  app.post('/api/helpdesk/queues', save);
  app.put('/api/helpdesk/queues/:id', save);
}
