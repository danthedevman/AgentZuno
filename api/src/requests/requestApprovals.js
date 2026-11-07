import { ObjectId } from 'mongodb';
import { deny } from '../identity/helpdeskRoles.js';
import { queryString } from '../shared/queryValues.js';
import { canReviewWorkflowApproval } from './approvalTargets.js';
import { canReadRequest } from './requestPolicy.js';

export async function requestApprovalHistory(store, user, request) {
  if (!(await canReadRequest(store, user, request))) deny('Request not found.', 404);
  const scope = {
    ownerId: queryString(request.ownerId),
    workspaceId: queryString(request.workspaceId),
  };
  const runs = await store
    .collection('workflowRuns')
    .find(
      { ...scope, requestId: String(request._id) },
      {
        projection: {
          _id: 1,
          revision: 1,
          status: 1,
          steps: 1,
          'definition.steps': 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    )
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray();
  const rows = (request.approvals || []).map((approval) => ({
    id: approval.id,
    title: approval.action,
    status: approval.status,
    reason: approval.reason || '',
    target: 'Support approval',
    createdAt: approval.createdAt,
    completedAt: approval.decidedAt || null,
    decidedBy: approval.decidedBy || '',
    comment: approval.comment || '',
    canDecide:
      approval.status === 'pending' &&
      user.canApprove === true &&
      (user.role === 'admin' ||
        (user.role === 'agent' && (user.queues || []).includes(request.queueName))),
  }));
  for (const run of runs) {
    for (const declared of (run.definition?.steps || []).filter(
      (step) => step.action === 'approval',
    )) {
      const step = (run.steps || []).find(
        (step) => step.id === declared.id && step.action === 'approval',
      );
      const result = step?.result;
      const status = result?.skipped
        ? 'skipped'
        : typeof result?.approved === 'boolean'
          ? result.approved
            ? 'approved'
            : 'rejected'
          : step?.status === 'blocked' ||
              (step?.status === 'awaiting-approval' && run.status === 'failed')
            ? 'blocked'
            : step?.status === 'awaiting-approval'
              ? 'pending'
              : step?.status === 'failed'
                ? 'failed'
                : ['complete', 'failed', 'canceled'].includes(run.status)
                  ? 'not-reached'
                  : 'not-started';
      const params = declared.params || {};
      let target = params.target === 'manager' ? 'Requester’s manager' : 'Approver';
      if (params.target === 'group') {
        const group =
          typeof params.groupId === 'string' && ObjectId.isValid(params.groupId)
            ? await store
                .collection('approvalGroups')
                .findOne(
                  { ...scope, _id: new ObjectId(params.groupId) },
                  { projection: { name: 1 } },
                )
            : null;
        target = group?.name || 'Approval group';
      }
      rows.push({
        id: `${run._id}:${declared.id}`,
        runId: String(run._id),
        stepId: declared.id,
        title: 'Workflow approval',
        target,
        status,
        revision: run.revision,
        requireRejectionComment: step?.requireRejectionComment === true,
        canDecide:
          status === 'pending' &&
          (step?.resolvedUserIds || [step?.input?.userId]).includes(user.id) &&
          (await canReviewWorkflowApproval(store, user, String(request._id))),
        reason: step?.input?.reason || params.reason || '',
        explanation:
          status === 'skipped'
            ? 'Approval conditions did not match.'
            : status === 'blocked'
              ? step.failureReason ||
                'Approval could not be assigned. The workflow stopped before a decision.'
              : status === 'not-reached'
                ? 'The workflow did not reach this approval.'
                : '',
        createdAt: step?.startedAt || null,
        completedAt: step?.completedAt || null,
        decidedBy: result?.decidedBy || '',
        comment: result?.comment || '',
      });
    }
  }
  for (const row of rows) {
    if (!row.decidedBy) {
      row.decidedBy = null;
      continue;
    }
    const member = await store
      .collection('helpdeskMembers')
      .findOne({ ...scope, userId: queryString(row.decidedBy) }, { projection: { userId: 1 } });
    const account =
      member &&
      (await store
        .collection('users')
        .findOne({ id: queryString(member.userId) }, { projection: { name: 1 } }));
    row.decidedBy = account?.name || 'Approver';
  }
  return rows;
}
