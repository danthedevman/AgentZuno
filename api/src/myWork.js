import { listResponse, requestListColumns } from './listQuery.js';
import { workspaceGroups } from './groups.js';
import { deny, requestScope, helpdeskScope } from './helpdeskRoles.js';

export function installMyWorkRoutes(app, store) {
  app.get('/api/helpdesk/my-work', async (request, response) => {
    const user = request.helpdeskUser;
    if (!['admin', 'agent'].includes(user.role)) deny();
    const status = request.query.status;
    if (status && !['open', 'in-progress', 'waiting-for-employee', 'resolved'].includes(status))
      deny('Invalid status.', 400);
    const filter = {
      $and: [requestScope(user), { assignedToId: user.id }, ...(status ? [{ status }] : [])],
    };
    const requests = store.collection('helpdeskRequests');
    if (request.query.summary === '1') {
      const [report] = await requests
        .aggregate([
          { $match: filter },
          {
            $facet: {
              statuses: [{ $group: { _id: '$status', value: { $sum: 1 } } }, { $sort: { _id: 1 } }],
              groups: [
                { $group: { _id: '$queueName', value: { $sum: 1 } } },
                { $sort: { value: -1, _id: 1 } },
              ],
            },
          },
        ])
        .toArray();
      return response.json({
        total: report.statuses.reduce((sum, item) => sum + item.value, 0),
        statuses: report.statuses.map((item) => ({ name: item._id || 'open', value: item.value })),
        groups: report.groups.map((item) => ({
          name: item._id || 'Unassigned',
          value: item.value,
        })),
      });
    }
    const rows = await requests
      .find(filter, {
        projection: {
          title: 1,
          number: 1,
          status: 1,
          priority: 1,
          queueName: 1,
          updatedAt: 1,
          chatId: 1,
        },
      })
      .toArray();
    response.json(
      listResponse(
        request,
        rows.map(({ _id, ...row }) => ({ ...row, id: String(_id) })),
        requestListColumns,
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  });
  app.get('/api/helpdesk/my-team', async (request, response) => {
    const user = request.helpdeskUser;
    if (!['admin', 'agent', 'read-only'].includes(user.role)) deny();
    const groups = (await workspaceGroups(store, user)).filter(
      (group) =>
        group.assignmentEnabled &&
        (user.role !== 'agent' || (user.queues || []).includes(group.name)),
    );
    const filter = {
      ...helpdeskScope(user),
      submissionState: 'submitted',
      queueName: { $in: groups.map((group) => group.name) },
    };
    const rows = await store
      .collection('helpdeskRequests')
      .find(filter, {
        projection: {
          title: 1,
          number: 1,
          status: 1,
          queueName: 1,
          assignedToId: 1,
          updatedAt: 1,
          chatId: 1,
        },
      })
      .toArray();
    if (request.query.summary === '1')
      return response.json({
        total: rows.length,
        active: rows.filter((row) => row.status !== 'resolved').length,
        unassigned: rows.filter((row) => !row.assignedToId).length,
        groups: groups.length,
      });
    if (request.query.kind === 'groups')
      return response.json(
        listResponse(
          request,
          groups.map((group) => ({
            id: String(group._id),
            name: group.name,
            members: (group.userIds || []).length,
            active: rows.filter((row) => row.queueName === group.name && row.status !== 'resolved')
              .length,
            total: rows.filter((row) => row.queueName === group.name).length,
            updatedAt: group.updatedAt || group.createdAt,
          })),
          {
            Group: 'name',
            Members: 'members',
            Active: 'active',
            Total: 'total',
            Updated: (row) => Date.parse(row.updatedAt),
          },
        ),
      );
    response.json(
      listResponse(
        request,
        rows.map(({ _id, ...row }) => ({ ...row, id: String(_id) })),
        requestListColumns,
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  });
}
