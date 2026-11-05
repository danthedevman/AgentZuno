import { recordMentionRecords, recordMentionDto } from './recordMentions.js';
import { ObjectId } from 'mongodb';
import { helpdeskScope, requestScope } from './helpdeskRoles.js';
import { queryString } from './queryValues.js';
import { canReviewWorkflowApproval } from './approvalTargets.js';
import { taskAssignmentMatches } from './requestTasks.js';
import { inboxMatches, requestMentionNotice } from './mentions.js';
import { databasePage, parseListQuery, listSearch } from './databasePage.js';

const columns = {
  Request: 'title',
  Subject: 'title',
  Status: { field: 'status', type: 'status' },
  Queue: 'queueName',
  Updated: { field: 'updatedAt', type: 'date' },
};
const projection = { messages: 0, events: 0, approvals: 0, workNotes: 0 };
function search(q) {
  const filter = listSearch(q, ['title', 'queueName', 'status']);
  if (q) {
    for (const [status, label] of [
      ['waiting-for-employee', 'Awaiting Response'],
      ['waiting-for-approval', 'Awaiting Approval'],
    ])
      if (label.toLowerCase().includes(q.toLowerCase())) filter.$or.push({ status });
  }
  return filter;
}
async function readable(store, service, user, candidate) {
  const scope = helpdeskScope(user);
  const alternatives = [{ requesterId: user.id }];
  if (user.role === 'admin' || user.role === 'read-only') alternatives.push(scope);
  if (user.role === 'agent') alternatives.push({ queueName: { $in: user.queues || [] } });
  if (user.canApprove) {
    const runs = await store
      .collection('workflowRuns')
      .find({ ...scope, status: 'awaiting-approval' }, { projection: { requestId: 1 } })
      .toArray();
    const ids = [
      ...new Set(
        runs
          .map((run) => run.requestId)
          .filter((id) => typeof id === 'string' && ObjectId.isValid(id)),
      ),
    ];
    const approved = [];
    for (const id of ids)
      if (await canReviewWorkflowApproval(store, user, new ObjectId(id)))
        approved.push(new ObjectId(id));
    alternatives.push({ _id: { $in: approved } });
  }
  // Legacy chat-only rows predate explicit submissionState. Only their identifiers
  // are inspected before the native page query; current submitted records need no join.
  const legacy = await store
    .collection('helpdeskRequests')
    .find(
      { $and: [candidate, { channel: 'web', submissionState: { $exists: false } }] },
      { projection: { _id: 1, requesterId: 1, workspaceId: 1, requestId: 1, channel: 1 } },
    )
    .toArray();
  const excluded = [];
  for (const record of legacy) if (!(await service.isSubmitted(record))) excluded.push(record._id);
  return {
    $and: [
      candidate,
      { $or: alternatives },
      {
        $or: [
          { submissionState: 'submitted' },
          { submissionState: { $exists: false } },
          { submissionState: null },
          { submissionState: '' },
        ],
      },
      { _id: { $nin: excluded } },
    ],
  };
}
export async function requestListPage(store, service, user, query, filters = {}) {
  const options = parseListQuery(query, columns, { sort: 'Updated', direction: 'desc' });
  const filter = await readable(store, service, user, { ...requestScope(user), ...filters });
  const result = await databasePage(
    store,
    [{ name: 'helpdeskRequests', filter: { $and: [filter, search(options.q)] } }],
    { ...options, projection },
  );
  return { ...result, rows: result.rows.map((record) => service.safeRequest(record, user)) };
}
export async function inboxListPage(store, service, user, query, tab) {
  const options = parseListQuery(query, columns, { sort: 'Updated', direction: 'desc' });
  const scope = helpdeskScope(user);
  const states = await store
    .collection('helpdeskInbox')
    .find(
      { ownerId: queryString(user.id), workspaceId: scope.workspaceId, archived: true },
      { projection: { requestId: 1, taskId: 1, kind: 1 } },
    )
    .toArray();
  const archivedRequests = states
    .map((state) => state.requestId)
    .filter((id) => id instanceof ObjectId);
  const archivedTasks = states
    .map((state) => state.taskId)
    .filter((id) => id instanceof ObjectId || (typeof id === 'string' && ObjectId.isValid(id)))
    .map((id) => new ObjectId(id));
  const archiveOperator = tab === 'archive' ? '$in' : '$nin';
  const requestFilter = await readable(store, service, user, { ...scope, $or: inboxMatches(user) });
  const taskFilter = { ...scope, $or: taskAssignmentMatches(user) };
  const tasks = await store
    .collection('helpdeskTasks')
    .find(taskFilter, { projection: { requestId: 1 } })
    .toArray();
  const parentIds = [
    ...new Set(
      tasks
        .map((task) => task.requestId)
        .filter((id) => typeof id === 'string' && ObjectId.isValid(id)),
    ),
  ];
  const parents = await store
    .collection('helpdeskRequests')
    .find(
      {
        ...scope,
        _id: { $in: parentIds.map((id) => new ObjectId(id)) },
        $or: [{ submissionState: 'submitted' }, { submissionState: { $exists: false } }],
      },
      { projection: { _id: 1 } },
    )
    .toArray();
  const mentions = await recordMentionRecords(store, user);
  const archivedMentions = states
    .filter((state) => state.kind === 'record-mention')
    .map((state) => state.requestId);
  const result = await databasePage(
    store,
    [
      {
        name: 'helpdeskRequests',
        filter: {
          $and: [
            requestFilter,
            { _id: { [archiveOperator]: archivedRequests } },
            search(options.q),
          ],
        },
      },
      {
        name: 'helpdeskTasks',
        kind: 'task',
        filter: {
          $and: [
            taskFilter,
            {
              requestId: { $in: parents.map((parent) => String(parent._id)) },
              _id: { [archiveOperator]: archivedTasks },
            },
            search(options.q),
          ],
        },
      },
      {
        name: 'recordActivity',
        kind: 'record-mention',
        filter: {
          $and: [
            scope,
            {
              _id: {
                $in: mentions
                  .filter(
                    (item) =>
                      archivedMentions.some((id) => String(id) === String(item._id)) ===
                      (tab === 'archive'),
                  )
                  .map((item) => item._id),
              },
            },
            search(options.q),
          ],
        },
      },
    ],
    { ...options, projection },
  );
  return {
    ...result,
    rows: result.rows.map((record) =>
      record.kind === 'record-mention'
        ? recordMentionDto(record)
        : record.kind === 'task'
          ? {
              id: String(record._id),
              kind: 'task',
              taskId: String(record._id),
              requestId: record.requestId,
              title: record.title,
              description: record.description,
              status: record.status,
              queueName: record.queueName,
              assignedToId: record.assignedToId,
              assignedToName: record.assignedToName,
              number: 'Task',
              updatedAt: record.updatedAt,
              inboxNotice: 'Fulfillment Task',
              href: `/workspace/tasks/${record._id}`,
            }
          : {
              ...service.safeRequest(record, user),
              inboxNotice: requestMentionNotice(user, record),
            },
    ),
  };
}
