import { requireExistingQueues } from './helpdeskQueues.js';
import { listResponse } from './listQuery.js';
export const helpdeskRoles = ['admin', 'agent', 'user', 'read-only'];

export function deny(message = 'You do not have permission to perform this action.', status = 403) {
  throw Object.assign(new Error(message), { status, publicMessage: message });
}
export function requireRole(user, roles) {
  if (
    !roles.includes(user.role) &&
    !(user.role === 'read-only' && user.readOnlyRequest && roles.includes('admin'))
  )
    deny();
}
export function helpdeskScope(user) {
  return { ownerId: user.helpdeskOwnerId || user.id, workspaceId: user.workspaceId };
}
export function requestScope(user) {
  requireRole(user, helpdeskRoles);
  const filter = helpdeskScope(user);
  if (user.role === 'user') {
    if (user.canApprove) filter.$or = [{ requesterId: user.id }, { approvalUserIds: user.id }];
    else filter.requesterId = user.id;
  }
  if (user.role === 'agent')
    filter.$or = [{ requesterId: user.id }, { queueName: { $in: user.queues || [] } }];
  return filter;
}

export function requireRequestOperator(user, record) {
  requireRole(user, ['admin', 'agent']);
  if (user.role === 'agent' && !(user.queues || []).includes(record.queueName))
    deny('This request is outside your assigned queues.');
}

export async function resolveHelpdeskUser(store, user, workspaceId = user?.workspaceId) {
  if (!user || user.isDemo) deny('Sign in with a registered account to use the help desk.', 401);
  if (typeof workspaceId !== 'string' || !/^[a-f0-9]{24}$/.test(workspaceId))
    deny('Invalid workspace.', 400);
  await store.ready();
  const owner = await store.collection('users').findOne({ workspaceId });
  if (!owner) deny('You do not have access to this workspace.');
  try {
    if (!(await store.collection('helpdeskMembers').findOne({ workspaceId, userId: owner.id })))
      await store.collection('helpdeskMembers').updateOne(
        { workspaceId, userId: owner.id },
        {
          $setOnInsert: {
            workspaceId,
            userId: owner.id,
            ownerId: owner.id,
            email: owner.email,
            role: 'admin',
            active: true,
            queues: [],
            canApprove: false,
            version: 1,
            createdAt: owner.createdAt || new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const member = await store
    .collection('helpdeskMembers')
    .findOne({ workspaceId, userId: user.id });
  const isOwner = owner.id === user.id;
  if (!isOwner && (!member?.active || !helpdeskRoles.includes(member.role)))
    deny('You do not have access to this workspace.');
  return {
    ...user,
    workspaceId,
    helpdeskOwnerId: owner.id,
    role: isOwner ? 'admin' : member.role,
    queues: member?.queues || [],
    canApprove: member?.canApprove === true,
    isWorkspaceOwner: isOwner,
  };
}

export function assumeHelpdeskRole(user, role) {
  if (!role) return user;
  if (user.role !== 'admin') deny('Only Admins can impersonate a role.');
  if (!helpdeskRoles.includes(role)) deny('Choose a valid role.', 400);
  return {
    ...user,
    actualRole: 'admin',
    role,
    canImpersonate: true,
    isImpersonating: role !== 'admin',
    canApprove: role === 'admin' ? user.canApprove : false,
    queues: role === 'agent' ? user.queues || [] : [],
  };
}

export function validateMember(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !['email', 'role', 'queues', 'canApprove', 'active', 'version'].includes(key),
    )
  )
    deny('Invalid member fields.', 400);
  if (
    !helpdeskRoles.includes(input.role) ||
    typeof input.active !== 'boolean' ||
    typeof input.canApprove !== 'boolean'
  )
    deny('Choose a valid role, active state, and approval permission.', 400);
  if (
    !Array.isArray(input.queues) ||
    input.queues.length > 30 ||
    input.queues.some((queue) => typeof queue !== 'string' || !queue.trim() || queue.length > 80)
  )
    deny('Choose up to 30 queue names of 1–80 characters.', 400);
  if (['user', 'read-only'].includes(input.role) && input.queues.length)
    deny('Queue assignments apply to Admins and Agents only.', 400);
  return {
    role: input.role,
    active: input.active,
    canApprove: input.role !== 'read-only' && input.canApprove,
    queues: [...new Set(input.queues.map((queue) => queue.trim()))],
  };
}
const safeMember = (record) => ({
  userId: record.userId,
  email: record.email,
  role: record.role,
  queues: record.queues,
  active: record.active,
  canApprove: record.canApprove,
  version: record.version,
});

export function installHelpdeskMemberRoutes(app, store) {
  app.get('/api/helpdesk/access', (request, response) => {
    const user = request.helpdeskUser;
    response.json({
      workspaceId: user.workspaceId,
      role: user.role,
      actualRole: user.actualRole || user.role,
      canImpersonate: (user.actualRole || user.role) === 'admin',
      isImpersonating: user.isImpersonating === true,
      queues: user.queues,
      canApprove: user.canApprove,
    });
  });
  app.get('/api/helpdesk/workspaces', async (request, response) => {
    const user = request.user;
    const memberships = await store
      .collection('helpdeskMembers')
      .find({ userId: user.id, active: true, workspaceId: { $ne: user.workspaceId } })
      .limit(100)
      .toArray();
    response.json([
      { workspaceId: user.workspaceId, role: 'admin', isPersonal: true },
      ...memberships.map((member) => ({
        workspaceId: member.workspaceId,
        role: member.role,
        isPersonal: false,
      })),
    ]);
  });
  app.get('/api/helpdesk/members', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const owner = await store.collection('users').findOne({ id: user.helpdeskOwnerId });
    const records = await store
      .collection('helpdeskMembers')
      .find({ workspaceId: user.workspaceId })
      .sort({ email: 1 })
      .limit(200)
      .toArray();
    if (!records.some((record) => record.userId === owner.id))
      records.unshift({
        userId: owner.id,
        email: owner.email,
        role: 'admin',
        queues: [],
        active: true,
        canApprove: false,
        version: 0,
      });
    const profiles =
      request.query.list === '1'
        ? await store.collection('workforceProfiles').find(helpdeskScope(user)).toArray()
        : [];
    const references =
      request.query.list === '1'
        ? await store.collection('workforceReferences').find(helpdeskScope(user)).toArray()
        : [];
    const accounts = await store
      .collection('users')
      .find(
        { id: { $in: records.map((record) => record.userId) } },
        { projection: { id: 1, name: 1 } },
      )
      .toArray();
    const values = records.map((member) => {
      const profile = profiles.find((item) => item.userId === member.userId);
      return {
        ...safeMember(member),
        name: accounts.find((account) => account.id === member.userId)?.name || member.email,
        title: profile?.title || '',
        department: references.find((item) => item._id === profile?.department)?.name || '',
        manager: records.find((item) => item.userId === profile?.manager)?.email || '',
      };
    });
    response.json(
      listResponse(request, values, {
        User: 'email',
        Role: 'role',
        Status: (item) => (item.active ? 'Active' : 'Disabled'),
        Queues: (item) => item.queues.join(', '),
        Title: 'title',
        Department: 'department',
        Manager: 'manager',
      }),
    );
  });
  async function save(request, response, isNew) {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body;
    const value = validateMember(input);
    await requireExistingQueues(store, user, value.queues);
    let target;
    if (isNew) {
      if (typeof input.email !== 'string' || input.email.length > 254)
        deny('Provide an existing registered account email.', 400);
      target = await store.collection('users').findOne({ email: input.email.trim().toLowerCase() });
      if (!target) deny('Registered account not found.', 404);
      if (input.version !== undefined) deny('New memberships do not accept a version.', 400);
    } else {
      if (input.email !== undefined) deny('Member identity cannot be changed.', 400);
      target = await store.collection('users').findOne({ id: request.params.id });
      if (!target) deny('Member not found.', 404);
      if (!Number.isInteger(input.version)) deny('Provide the current member version.', 400);
    }
    if (target.id === user.helpdeskOwnerId && (value.role !== 'admin' || !value.active))
      deny('The workspace owner must remain an active Admin.');
    if (target.id === user.id && target.id !== user.helpdeskOwnerId)
      deny('Another Admin must change your own membership.');
    const collection = store.collection('helpdeskMembers');
    const filter = { workspaceId: user.workspaceId, userId: target.id };
    const now = new Date();
    let record;
    if (isNew) {
      if (
        await store
          .collection('identitySettings')
          .findOne({ ...helpdeskScope(user), enabled: true })
      )
        deny('Users are managed by the identity provider.', 409);
      if ((await collection.countDocuments({ workspaceId: user.workspaceId })) >= 200)
        deny('Workspace membership limit reached.', 422);
      record = {
        ...filter,
        ownerId: user.helpdeskOwnerId,
        email: target.email,
        ...value,
        version: 1,
        createdAt: now,
        updatedAt: now,
        updatedBy: user.id,
      };
      try {
        await collection.insertOne(record);
      } catch (error) {
        if (error.code === 11000) deny('Member already exists. Use the edit endpoint.', 409);
        throw error;
      }
    } else {
      if (!(await collection.findOne(filter))) deny('Member not found.', 404);
      record = await collection.findOneAndUpdate(
        { ...filter, version: input.version },
        { $set: { ...value, updatedAt: now, updatedBy: user.id }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
      if (!record) deny('Membership changed. Reload before saving.', 409);
    }
    const event = {
      workspaceId: user.workspaceId,
      ownerId: user.helpdeskOwnerId,
      actorId: user.id,
      targetUserId: target.id,
      role: value.role,
      queues: value.queues,
      active: value.active,
      canApprove: value.canApprove,
      version: record.version,
      at: now,
    };
    response.locals.membershipChange = event;
    await store.collection('helpdeskMembershipHistory').insertOne(event);
    response.status(isNew ? 201 : 200).json(safeMember(record));
  }
  app.post('/api/helpdesk/members', (request, response) => save(request, response, true));
  app.put('/api/helpdesk/members/:id', (request, response) => save(request, response, false));
}
