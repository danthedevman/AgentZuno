import { listResponse, requestListColumns } from './listQuery.js';
import { deny, requestScope } from './helpdeskRoles.js';

export function installMyWorkRoutes(app, store) {
  app.get('/api/helpdesk/my-work', async (request, response) => {
    const user = request.helpdeskUser;
    if (!['admin', 'agent'].includes(user.role)) deny();
    const filter = { $and: [requestScope(user), { assignedToId: user.id }] };
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
}
