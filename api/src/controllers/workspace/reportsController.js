import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';
import { listResponse } from '../../shared/listQuery.js';
import { ObjectId } from 'mongodb';

export function createReportsController(store) {
  const getReportsKind = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const days = Number(request.query.days || 30);
    if (![7, 30, 90].includes(days)) deny('Choose a 7, 30, or 90 day reporting period.', 400);
    const since = new Date(Date.now() - days * 86400000);
    const scope = helpdeskScope(user);
    const kind = request.params.kind;
    if (kind === 'workflows') {
      const [result] = await store
        .collection('workflowRuns')
        .aggregate([
          { $match: { ...scope, createdAt: { $gte: since } } },
          {
            $facet: {
              statuses: [{ $group: { _id: '$status', value: { $sum: 1 } } }],
              rows: [
                {
                  $group: {
                    _id: '$workflowId',
                    runs: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$status', 'complete'] }, 1, 0] } },
                    failed: {
                      $sum: { $cond: [{ $in: ['$status', ['failed', 'delivery-unknown']] }, 1, 0] },
                    },
                    awaitingApproval: {
                      $sum: { $cond: [{ $eq: ['$status', 'awaiting-approval'] }, 1, 0] },
                    },
                  },
                },
                { $sort: { runs: -1 } },
                { $limit: 50 },
              ],
              duration: [
                { $match: { status: 'complete', completedAt: { $type: 'date' } } },
                {
                  $group: {
                    _id: null,
                    milliseconds: { $avg: { $subtract: ['$completedAt', '$createdAt'] } },
                  },
                },
              ],
            },
          },
        ])
        .toArray();
      const ids = result.rows
        .map((row) => row._id)
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
      const workflows = await store
        .collection('helpdeskWorkflows')
        .find({ ...scope, _id: { $in: ids } }, { projection: { name: 1 } })
        .toArray();
      const rows = result.rows.map((row) => ({
        id: row._id,
        name:
          workflows.find((workflow) => String(workflow._id) === row._id)?.name ||
          'Removed Workflow',
        runs: row.runs,
        completed: row.completed,
        failed: row.failed,
        awaitingApproval: row.awaitingApproval,
      }));
      if (request.query.list === '1')
        return response.json(
          listResponse(
            request,
            rows,
            {
              Workflow: 'name',
              Runs: 'runs',
              Completed: 'completed',
              Failed: 'failed',
              'Awaiting Approval': 'awaitingApproval',
            },
            { sort: 'Runs', direction: 'desc' },
          ),
        );
      const statuses = result.statuses.map((row) => ({ label: row._id, value: row.value }));
      return response.json({
        days,
        total: statuses.reduce((sum, row) => sum + row.value, 0),
        statuses,
        averageElapsedSeconds: result.duration[0]
          ? Math.round(result.duration[0].milliseconds / 1000)
          : null,
      });
    }
    if (kind === 'agents') {
      const rows = await store
        .collection('chats')
        .aggregate([
          { $match: { workspaceId: user.workspaceId, providerOwnerId: scope.ownerId } },
          { $unwind: '$messages' },
          {
            $match: {
              'messages.role': 'assistant',
              'messages.kind': { $ne: 'request-confirmation' },
              'messages.createdAt': { $gte: since },
              $or: [{ 'messages.model': { $type: 'string' } }, { 'messages.status': 'failed' }],
            },
          },
          {
            $group: {
              _id: { $cond: [{ $eq: ['$assistantType', 'admin'] }, 'admin', 'support'] },
              conversations: { $addToSet: '$_id' },
              completed: { $sum: { $cond: [{ $eq: ['$messages.status', 'complete'] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $eq: ['$messages.status', 'failed'] }, 1, 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: { $cond: [{ $eq: ['$_id', 'admin'] }, 'Admin Agent', 'Support Agent'] },
              conversations: { $size: '$conversations' },
              completed: 1,
              failed: 1,
            },
          },
          { $sort: { name: 1 } },
        ])
        .toArray();
      if (request.query.list === '1')
        return response.json(
          listResponse(request, rows, {
            Agent: 'name',
            Conversations: 'conversations',
            'Completed Responses': 'completed',
            'Failed Responses': 'failed',
          }),
        );
      const requestsSubmitted = await store.collection('helpdeskRequests').countDocuments({
        ...scope,
        submittedVia: 'zuno',
        submissionState: 'submitted',
        createdAt: { $gte: since },
      });
      return response.json({
        days,
        rows,
        requestsSubmitted,
        completed: rows.reduce((sum, row) => sum + row.completed, 0),
        failed: rows.reduce((sum, row) => sum + row.failed, 0),
      });
    }
    deny('Report not found.', 404);
  };
  return { getReportsKind };
}
