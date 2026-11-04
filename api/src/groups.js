import { requireCompatibleDemoReferences } from './demoReferences.js';
import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
import { listResponse } from './listQuery.js';

export const groupId = (user, name) =>
  new ObjectId(
    createHash('sha256')
      .update(JSON.stringify([helpdeskScope(user), name.toLowerCase()]))
      .digest('hex')
      .slice(0, 24),
  );
export async function workspaceGroups(store, user) {
  const scope = helpdeskScope(user);
  const [legacy, members, settings] = await Promise.all([
    store.collection('helpdeskQueues').find(scope).toArray(),
    store.collection('helpdeskMembers').find(scope).toArray(),
    store.collection('helpdeskSettings').findOne(scope),
  ]);
  const collection = store.collection('approvalGroups');
  const saved = await collection.find(scope).toArray();
  for (const group of saved.filter((record) => !record.unifiedVersion)) {
    await collection.updateOne(
      { ...scope, _id: group._id, unifiedVersion: { $exists: false } },
      {
        $set: {
          unifiedVersion: 1,
          assignmentEnabled: false,
          approvalEnabled: true,
          routingInstructions: group.routingInstructions || '',
        },
      },
    );
  }
  const names = [
    ...new Set([
      ...legacy.map((item) => item.name),
      ...members.flatMap((item) => item.queues || []),
      ...(settings?.routing || []).map((item) => item.queueName),
    ]),
  ];
  for (const name of names) {
    const previous = saved.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (previous?.unifiedVersion) continue;
    const queue = legacy.find((item) => item.name === name);
    const ids = members
      .filter(
        (member) =>
          member.active &&
          ['admin', 'agent'].includes(member.role) &&
          member.queues?.includes(name),
      )
      .map((member) => member.userId);
    await collection.updateOne(
      { ...scope, _id: previous?._id || groupId(user, name) },
      {
        $setOnInsert: {
          ...scope,
          name,
          active: true,
          description: queue?.description || '',
          createdAt: new Date(),
          version: 1,
        },
        $set: {
          unifiedVersion: 1,
          assignmentEnabled: true,
          approvalEnabled: !!previous,
          routingInstructions: queue?.routingInstructions || '',
          userIds: [...new Set([...(previous?.userIds || []), ...ids])],
          legacyQueueName: name,
        },
      },
      { upsert: true },
    );
  }
  return collection.find(scope).toArray();
}
export function presentGroup(record) {
  return {
    id: String(record._id),
    name: record.name,
    description: record.description || '',
    userIds: record.userIds || [],
    active: record.active !== false,
    assignmentEnabled: !!record.assignmentEnabled,
    approvalEnabled: record.approvalEnabled !== false,
    routingInstructions: record.routingInstructions || '',
    version: record.version || 1,
    updatedAt: record.updatedAt || record.createdAt,
  };
}
export function installGroupRoutes(app, store) {
  app.get('/api/helpdesk/groups', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const rows = (await workspaceGroups(store, request.helpdeskUser)).map(presentGroup);
    response.json(
      listResponse(request, rows, {
        Group: 'name',
        Description: 'description',
        Members: (item) => item.userIds.length,
        Assignment: (item) => item.assignmentEnabled,
        Approval: (item) => item.approvalEnabled,
        Updated: (item) => Date.parse(item.updatedAt),
      }),
    );
  });
  app.get('/api/helpdesk/groups/:id', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const group = (await workspaceGroups(store, request.helpdeskUser)).find(
      (item) => String(item._id) === request.params.id,
    );
    if (!group) deny('Group not found.', 404);
    response.json(presentGroup(group));
  });
  async function save(request, response) {
    const result = await saveGroup(store, request.helpdeskUser, request.body, request.params.id);
    response.status(request.params.id ? 200 : 201).json(result);
  }
  app.post('/api/helpdesk/groups', save);
  app.put('/api/helpdesk/groups/:id', save);
}

export async function saveGroup(store, user, input, id, creationContext) {
  requireRole(user, ['admin']);
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        ![
          'name',
          'description',
          'userIds',
          'active',
          'assignmentEnabled',
          'approvalEnabled',
          'routingInstructions',
          'version',
        ].includes(key),
    ) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 80 ||
    typeof input.description !== 'string' ||
    input.description.length > 1000 ||
    typeof input.routingInstructions !== 'string' ||
    input.routingInstructions.length > 2000 ||
    ['active', 'assignmentEnabled', 'approvalEnabled'].some(
      (key) => typeof input[key] !== 'boolean',
    ) ||
    !Array.isArray(input.userIds) ||
    input.userIds.length > 200 ||
    input.userIds.some((id) => typeof id !== 'string' || id.length > 80)
  )
    deny('Invalid group fields.', 400);
  const all = await workspaceGroups(store, user);
  const previous = id ? all.find((item) => String(item._id) === id) : null;
  if (id && !previous) deny('Group not found.', 404);
  await requireCompatibleDemoReferences(store, user, previous, { userIds: input.userIds });
  if (
    previous &&
    (previous.assignmentEnabled || previous.legacyQueueName) &&
    previous.name !== input.name.trim()
  )
    deny('Keep the name used by existing assignments.', 409);
  if (
    all.some(
      (item) =>
        String(item._id) !== id && item.name.toLowerCase() === input.name.trim().toLowerCase(),
    )
  )
    deny('A group with this name already exists.', 409);
  const ids = [...new Set(input.userIds)];
  const members = await store
    .collection('helpdeskMembers')
    .find({ ...helpdeskScope(user), active: true })
    .toArray();
  if (ids.some((id) => !members.some((member) => member.userId === id)))
    deny('Choose active workspace users.', 400);
  const values = {
    name: input.name.trim(),
    description: input.description.trim(),
    userIds: ids,
    active: input.active,
    assignmentEnabled: input.assignmentEnabled,
    approvalEnabled: input.approvalEnabled,
    routingInstructions: input.routingInstructions.trim(),
    unifiedVersion: 1,
    updatedAt: new Date(),
  };
  const collection = store.collection('approvalGroups');
  let record;
  if (previous) {
    if (!Number.isInteger(input.version)) deny('Invalid group version.', 400);
    record = await collection.findOneAndUpdate(
      { ...helpdeskScope(user), _id: previous._id, version: input.version },
      { $set: values, $inc: { version: 1 } },
      { returnDocument: 'after' },
    );
    if (!record) deny('Group changed. Reload before saving.', 409);
  } else {
    record = {
      _id: groupId(user, values.name),
      ...helpdeskScope(user),
      ...values,
      version: 1,
      createdAt: new Date(),
      ...(creationContext ? { createdFromChat: creationContext } : {}),
    };
    try {
      await collection.insertOne(record);
    } catch (error) {
      if (error.code === 11000) deny('Group already exists.', 409);
      throw error;
    }
  }
  // Existing request assignment checks use scoped member group names.
  const assigned =
    values.active && values.assignmentEnabled
      ? ids.filter((id) =>
          members.some(
            (member) => member.userId === id && ['admin', 'agent'].includes(member.role),
          ),
        )
      : [];
  for (const member of members) {
    const queues = (member.queues || []).filter((name) => name !== values.name);
    if (assigned.includes(member.userId)) queues.push(values.name);
    if (JSON.stringify(queues) !== JSON.stringify(member.queues || []))
      await store
        .collection('helpdeskMembers')
        .updateOne(
          { ...helpdeskScope(user), userId: member.userId },
          { $set: { queues }, $inc: { version: 1 } },
        );
  }
  return presentGroup(record);
}
