import { queryString } from '../shared/queryValues.js';

import { ObjectId } from 'mongodb';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { canUseWorkflow } from '../../sdk/workflows/index.js';

export async function workflowRequesterContext(store, request) {
  const scope = {
    ownerId: queryString(request.ownerId),
    workspaceId: queryString(request.workspaceId),
  };
  const profile = await store
    .collection('workforceProfiles')
    .findOne({ ...scope, userId: queryString(request.requesterId) });
  const department = profile?.department
    ? await store
        .collection('workforceReferences')
        .findOne({ ...scope, _id: profile.department, type: 'department' })
    : null;
  let managerId = profile?.manager || '';
  if (!managerId && profile?.managerDirectoryId && ObjectId.isValid(profile.managerDirectoryId)) {
    const manager = await store.collection('helpdeskDirectoryUsers').findOne({
      _id: new ObjectId(profile.managerDirectoryId),
      workspaceId: queryString(request.workspaceId),
      issuer: profile.issuer,
      active: true,
    });
    managerId = manager?.userId || '';
  }
  return {
    id: request.requesterId,
    departmentId: department?._id || '',
    department: department?.name || '',
    managerId,
  };
}
export async function resolveWorkflowApprovers(store, run, input) {
  const scope = { ownerId: run.ownerId, workspaceId: run.workspaceId };
  const target = input.target || (input.groupId ? 'group' : 'user');
  let ids;
  if (target === 'manager') {
    const profile = await workflowRequesterContext(store, { ...run, requesterId: run.actorId });
    ids = [profile.managerId];
  } else if (target === 'group') {
    if (!ObjectId.isValid(input.groupId)) deny('Choose an approval group.', 400);
    const group = await store.collection('approvalGroups').findOne({
      ...scope,
      _id: new ObjectId(input.groupId),
      active: true,
      approvalEnabled: { $ne: false },
    });
    if (!group) deny('Approval group is unavailable.');
    ids = group.userIds;
  } else if (target === 'user') ids = [input.userId];
  else deny('Invalid approval target.', 400);
  const members = await store
    .collection('helpdeskMembers')
    .find({
      ...scope,
      userId: {
        $in: (ids || []).filter((id) => typeof id === 'string' && id && id !== run.actorId),
      },
      active: true,
      canApprove: true,
    })
    .toArray();
  const accounts = await store
    .collection('users')
    .find({ id: { $in: members.map((member) => member.userId) } }, { projection: { id: 1 } })
    .toArray();
  const allowed = members
    .map((member) => member.userId)
    .filter((id) => accounts.some((account) => account.id === id));
  if (!allowed.length) deny('Choose another active user with approval permission.');
  return allowed;
}
export async function canReviewWorkflowApproval(store, user, requestId) {
  if (!user.canApprove) return false;
  const scope = helpdeskScope(user);
  const runs = await store
    .collection('workflowRuns')
    .find({ ...scope, requestId: String(requestId), status: 'awaiting-approval' })
    .toArray();
  for (const run of runs) {
    if (run.actorId === user.id) continue;
    const workflow =
      ObjectId.isValid(run.workflowId) &&
      (await store
        .collection('helpdeskWorkflows')
        .findOne({ ...scope, _id: new ObjectId(run.workflowId), enabled: true }));
    const requester = await store
      .collection('helpdeskMembers')
      .findOne({ ...scope, userId: run.actorId, active: true });
    if (
      !workflow ||
      !requester ||
      !canUseWorkflow(run.definition, { ...requester, id: run.actorId }) ||
      !canUseWorkflow(workflow.publishedConfig?.definition || {}, { ...requester, id: run.actorId })
    )
      continue;
    for (const step of run.steps || []) {
      if (
        step.action !== 'approval' ||
        step.status !== 'awaiting-approval' ||
        !(step.resolvedUserIds || [step.input.userId]).includes(user.id)
      )
        continue;
      try {
        if ((await resolveWorkflowApprovers(store, run, step.input)).includes(user.id)) return true;
      } catch {
        /* Revoked or missing targets deny access. */
      }
    }
  }
  return false;
}
export async function validateWorkflowApprovalTargets(store, user, definition) {
  for (const step of definition.steps.filter((step) => step.action === 'approval')) {
    if (step.params.target === 'user') {
      const member = await store.collection('helpdeskMembers').findOne({
        ...helpdeskScope(user),
        userId: step.params.userId,
        active: true,
        canApprove: true,
      });
      if (!member) deny('Choose an active approver in this workspace.', 400);
    }
    if (step.params.target === 'group') {
      const group =
        ObjectId.isValid(step.params.groupId) &&
        (await store.collection('approvalGroups').findOne({
          ...helpdeskScope(user),
          _id: new ObjectId(step.params.groupId),
          active: true,
          approvalEnabled: { $ne: false },
        }));
      if (!group?.userIds?.length) deny('Choose an active approval group.', 400);
    }
    if (step.when?.departmentIds) {
      const count = await store.collection('workforceReferences').countDocuments({
        ...helpdeskScope(user),
        type: 'department',
        _id: { $in: step.when.departmentIds },
      });
      if (count !== step.when.departmentIds.length)
        deny('Choose departments from this workspace.', 400);
    }
  }
}
