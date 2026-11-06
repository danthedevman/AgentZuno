import { ObjectId } from 'mongodb';
import { createUserAccess } from '../../requests/userAccess.js';
import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';
import { queryString } from '../../shared/queryValues.js';
import { canWorkRequest } from '../../requests/requestPolicy.js';
import { listResponse } from '../../shared/listQuery.js';
export function createUserAccessController(store) {
  const service = createUserAccess(store);
  const get = async (req, res) => res.json(await service.get(req.helpdeskUser, req.params.id));
  const change = async (req, res) =>
    res.json(await service.change(req.helpdeskUser, req.params.id, req.body));
  const list = async (req, res) => {
    const user = req.helpdeskUser;
    requireRole(user, ['admin', 'agent', 'user', 'read-only']);
    const filter = { ...helpdeskScope(user) };
    if (!['admin', 'read-only'].includes(user.role)) filter.userId = queryString(user.id);
    if (req.query.request) {
      if (typeof req.query.request !== 'string' || !/^[a-f0-9]{24}$/.test(req.query.request))
        deny('Invalid request.', 400);
      const parent = await store
        .collection('helpdeskRequests')
        .findOne({ ...helpdeskScope(user), _id: new ObjectId(req.query.request) });
      if (
        !parent ||
        (parent.requesterId !== user.id &&
          !canWorkRequest(user, parent) &&
          user.role !== 'read-only')
      )
        deny('Request not found.', 404);
      if (canWorkRequest(user, parent)) delete filter.userId;
      filter.requestId = queryString(req.query.request, 24);
    }
    const rows = await store
      .collection('userAccess')
      .find(filter, { projection: { ownerId: 0, workspaceId: 0, offerId: 0 } })
      .sort({ updatedAt: -1 })
      .limit(1000)
      .toArray();
    res.json(
      listResponse(
        req,
        rows.map(({ _id, ...row }) => ({ id: String(_id), ...row })),
        {
          Application: 'applicationName',
          User: 'userName',
          Access: 'accessLevel',
          Status: 'status',
          Updated: 'updatedAt',
        },
      ),
    );
  };
  return { get, change, list };
}
