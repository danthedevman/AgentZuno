import { queryString, queryVersion } from '../../shared/queryValues.js';
import { requireExistingQueues } from '../../identity/helpdeskQueues.js';
import { listResponse } from '../../shared/listQuery.js';
import {
  requireRole,
  helpdeskScope,
  safeMember,
  deny,
  validateMember,
} from '../../identity/helpdeskRoles.js';
export function createHelpdeskRolesController(store) {
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
      if (!Number.isSafeInteger(input.version)) deny('Provide the current member version.', 400);
    }
    if (target.id === user.id && !value.active)
      deny('You cannot deactivate your own account.', 409);
    if (target.id === user.helpdeskOwnerId && (value.role !== 'admin' || !value.active))
      deny('The workspace owner must remain an active Admin.');
    if (target.id === user.id && target.id !== user.helpdeskOwnerId)
      deny('Another Admin must change your own membership.');
    const collection = store.collection('helpdeskMembers');
    const filter = { workspaceId: queryString(user.workspaceId), userId: target.id };
    const now = new Date();
    let record;
    if (isNew) {
      if (
        await store
          .collection('identitySettings')
          .findOne({ ...helpdeskScope(user), enabled: true })
      )
        deny('Users are managed by the identity provider.', 409);
      if ((await collection.countDocuments({ workspaceId: queryString(user.workspaceId) })) >= 200)
        deny('Workspace membership limit reached.', 422);
      record = {
        ...filter,
        ownerId: queryString(user.helpdeskOwnerId),
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
        { ...filter, version: queryVersion(input.version) },
        { $set: { ...value, updatedAt: now, updatedBy: user.id }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
      if (!record) deny('Membership changed. Reload before saving.', 409);
    }
    const event = {
      workspaceId: queryString(user.workspaceId),
      ownerId: queryString(user.helpdeskOwnerId),
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
  const getAccess = (request, response) => {
    const user = request.helpdeskUser;
    response.json({
      workspaceId: queryString(user.workspaceId),
      ownerId: queryString(user.helpdeskOwnerId || user.id),
      role: user.role,
      actualRole: user.actualRole || user.role,
      canImpersonate: (user.actualRole || user.role) === 'admin',
      isImpersonating: user.isImpersonating === true,
      queues: user.queues,
      canApprove: user.canApprove,
    });
  };
  const getWorkspaces = async (request, response) => {
    const user = request.user;
    const memberships = await store
      .collection('helpdeskMembers')
      .find({ userId: queryString(user.id), active: true, workspaceId: { $ne: user.workspaceId } })
      .limit(100)
      .toArray();
    response.json([
      { workspaceId: queryString(user.workspaceId), role: 'admin', isPersonal: true },
      ...memberships.map((member) => ({
        workspaceId: queryString(member.workspaceId),
        role: member.role,
        isPersonal: false,
      })),
    ]);
  };
  const getMembers = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const owner = await store.collection('users').findOne({ id: user.helpdeskOwnerId });
    const records = await store
      .collection('helpdeskMembers')
      .find({ workspaceId: queryString(user.workspaceId) })
      .sort({ email: 1 })
      .limit(200)
      .toArray();
    if (!records.some((record) => record.userId === owner.id))
      records.unshift({
        userId: queryString(owner.id),
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
  };
  const deleteMembersId = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const scope = helpdeskScope(user),
      id = queryString(request.params.id, 80);
    if (id === scope.ownerId || id === user.id)
      deny('The workspace owner and your own membership cannot be deleted.', 409);
    if (await store.collection('identitySettings').findOne({ ...scope, enabled: true }))
      deny('Users are managed by the identity provider.', 409);
    if (
      request.body?.confirmed !== true ||
      !Number.isSafeInteger(request.body?.version) ||
      request.body.version < 0 ||
      Object.keys(request.body).some((key) => !['confirmed', 'version'].includes(key))
    )
      deny('Confirm the current membership before deleting.', 400);
    const member = await store.collection('helpdeskMembers').findOne({ ...scope, userId: id });
    if (!member) deny('Member not found.', 404);
    if (member.version !== request.body.version)
      deny('Membership changed. Reload before deleting.', 409);
    const deleted = await store.collection('helpdeskMembers').deleteOne({
      ...scope,
      userId: queryString(id, 80),
      version: queryVersion(request.body.version),
    });
    if (!deleted.deletedCount) deny('Membership changed. Reload before deleting.', 409);
    await store.collection('approvalGroups').updateMany(scope, {
      $pull: { userIds: id },
      $inc: { version: 1 },
      $set: { updatedAt: new Date() },
    });
    await store.collection('workforceProfiles').deleteMany({ ...scope, userId: id });
    await store
      .collection('workforceProfiles')
      .updateMany(
        { ...scope, manager: id },
        { $set: { manager: '', updatedAt: new Date() }, $inc: { version: 1 } },
      );
    await store.collection('helpdeskRequests').updateMany(
      { ...scope, assignedToId: id },
      {
        $unset: { assignedToId: '', assignedToName: '' },
        $inc: { version: 1 },
        $set: { updatedAt: new Date() },
      },
    );
    await store.collection('helpdeskMembershipHistory').insertOne({
      ...scope,
      actorId: user.id,
      targetUserId: id,
      action: 'removed',
      version: member.version,
      at: new Date(),
    });
    response.json({ removed: true });
  };
  const postMembers = (request, response) => save(request, response, true);
  const putMembersId = (request, response) => save(request, response, false);
  return { getAccess, getWorkspaces, getMembers, deleteMembersId, postMembers, putMembersId };
}
