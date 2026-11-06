import { canWorkRequest } from '../requests/requestPolicy.js';
import { queryString, queryStrings } from '../shared/queryValues.js';

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
  return {
    ownerId: queryString(user.helpdeskOwnerId || user.id),
    workspaceId: queryString(user.workspaceId),
  };
}
export function requestScope(user) {
  requireRole(user, helpdeskRoles);
  const filter = helpdeskScope(user);
  if (user.role === 'user') {
    if (user.canApprove)
      filter.$or = [
        { requesterId: queryString(user.id) },
        { approvalUserIds: queryString(user.id) },
      ];
    else filter.requesterId = queryString(user.id);
  }
  if (user.role === 'agent')
    filter.$or = [
      { requesterId: queryString(user.id) },
      { queueName: { $in: queryStrings(user.queues || [], 30, 80) } },
    ];
  return filter;
}

export function requireRequestOperator(user, record) {
  requireRole(user, ['admin', 'agent']);
  if (!canWorkRequest(user, record)) deny('This request is outside your assigned queues.');
}

export async function resolveHelpdeskUser(store, user, workspaceId = user?.workspaceId) {
  if (!user || user.isDemo) deny('Sign in with a registered account to use the help desk.', 401);
  if (typeof workspaceId !== 'string' || !/^[a-f0-9]{24}$/.test(workspaceId))
    deny('Invalid workspace.', 400);
  await store.ready();
  const owner = await store.collection('users').findOne({ workspaceId: queryString(workspaceId) });
  if (!owner) deny('You do not have access to this workspace.');
  try {
    if (
      !(await store
        .collection('helpdeskMembers')
        .findOne({ workspaceId: queryString(workspaceId), userId: queryString(owner.id) }))
    )
      await store.collection('helpdeskMembers').updateOne(
        { workspaceId: queryString(workspaceId), userId: queryString(owner.id) },
        {
          $setOnInsert: {
            workspaceId,
            userId: queryString(owner.id),
            ownerId: queryString(owner.id),
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
    .findOne({ workspaceId: queryString(workspaceId), userId: queryString(user.id) });
  const isOwner = owner.id === user.id;
  if (!isOwner && (!member?.active || !helpdeskRoles.includes(member.role)))
    deny('You do not have access to this workspace.');
  return Object.defineProperty(
    {
      ...user,
      workspaceId,
      helpdeskOwnerId: owner.id,
      role: isOwner ? 'admin' : member.role,
      queues: member?.queues || [],
      canApprove: member?.canApprove === true,
      isWorkspaceOwner: isOwner,
    },
    'permissionSessionId',
    { value: user.permissionSessionId },
  );
}

export function assumeHelpdeskRole(user, role) {
  if (!role) return user;
  if (user.role !== 'admin') deny('Only Admins can impersonate a role.');
  if (!helpdeskRoles.includes(role)) deny('Choose a valid role.', 400);
  return Object.defineProperty(
    {
      ...user,
      actualRole: 'admin',
      role,
      canImpersonate: true,
      isImpersonating: role !== 'admin',
      canApprove: role === 'admin' ? user.canApprove : false,
      queues: role === 'agent' ? user.queues || [] : [],
    },
    'permissionSessionId',
    { value: user.permissionSessionId },
  );
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
export const safeMember = (record) => ({
  userId: queryString(record.userId),
  email: record.email,
  role: record.role,
  queues: record.queues,
  active: record.active,
  canApprove: record.canApprove,
  version: record.version,
});
