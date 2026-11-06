import { listResponse } from '../../shared/listQuery.js';
import { canReviewWorkflowApproval } from '../../requests/approvalTargets.js';

import { ObjectId } from 'mongodb';

import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';

import { publicRun, createWorkflowExecution } from '../../workflows/workflowExecution.js';
export function createWorkflowExecutionController(store) {
  const service = createWorkflowExecution(store);
  const getWorkflowRuns = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin', 'agent', 'user']);
    const query = { ...helpdeskScope(user) };
    if (user.role !== 'admin')
      query.steps = {
        $elemMatch: {
          action: 'approval',
          $or: [{ resolvedUserIds: user.id }, { 'input.userId': user.id }],
        },
      };
    if (request.query.workflowId) query.workflowId = String(request.query.workflowId);
    if (request.query.requestId) query.requestId = String(request.query.requestId);
    const records = await store
      .collection('workflowRuns')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const visible = [];
    for (const record of records) {
      if (
        user.role !== 'admin' &&
        !(await canReviewWorkflowApproval(store, user, record.requestId))
      )
        continue;
      const value = publicRun(record);
      if (user.role !== 'admin')
        value.steps = value.steps.filter(
          (step) =>
            step.action === 'approval' &&
            (step.resolvedUserIds || [step.input.userId]).includes(user.id),
        );
      visible.push(value);
    }
    response.json(visible);
  };
  const getMyApprovals = async (request, response) => {
    const user = request.helpdeskUser;
    const rows = [];
    if (user.canApprove) {
      const runs = await store
        .collection('workflowRuns')
        .find({
          ...helpdeskScope(user),
          status: 'awaiting-approval',
          steps: {
            $elemMatch: {
              action: 'approval',
              $or: [{ resolvedUserIds: user.id }, { 'input.userId': user.id }],
            },
          },
        })
        .toArray();
      for (const run of runs) {
        if (!(await canReviewWorkflowApproval(store, user, run.requestId))) continue;
        const item = await store
          .collection('helpdeskRequests')
          .findOne({ ...helpdeskScope(user), _id: new ObjectId(run.requestId) });
        if (!item) continue;
        for (const step of run.steps.filter(
          (step) =>
            step.status === 'awaiting-approval' &&
            (step.resolvedUserIds || [step.input.userId]).includes(user.id),
        ))
          rows.push({
            id: `${run._id}:${step.id}`,
            requestId: run.requestId,
            chatId: item.chatId,
            number: item.number,
            title: item.title,
            reason: step.input.reason,
            updatedAt: run.updatedAt,
          });
      }
    }
    response.json(
      listResponse(
        request,
        rows,
        { Request: 'title', Reason: 'reason', Updated: (item) => Date.parse(item.updatedAt) },
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  };
  const postWorkflowRunsIdDecisions = async (request, response) => {
    if (
      !request.body ||
      Object.keys(request.body).some((key) => !['stepId', 'approved', 'comment'].includes(key))
    )
      deny('Invalid decision.', 400);
    const result = await service.decide(
      request.helpdeskUser,
      request.params.id,
      request.body.stepId,
      request.body.approved,
      request.body.comment,
    );
    response.json(result);
  };
  return { getWorkflowRuns, getMyApprovals, postWorkflowRunsIdDecisions };
}
