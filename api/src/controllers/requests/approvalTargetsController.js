import { queryVersion } from '../../shared/queryValues.js';
import { requireCompatibleDemoReferences } from '../../demo/demoReferences.js';
import { workspaceGroups } from '../../identity/groups.js';
import { ObjectId } from 'mongodb';
import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';

import { listResponse } from '../../shared/listQuery.js';

export function createApprovalTargetsController(store) {
  const present = (record) => ({
    id: String(record._id),
    name: record.name,
    description: record.description,
    userIds: record.userIds,
    active: record.active,
    version: record.version,
    updatedAt: record.updatedAt,
  });
  async function save(request, response) {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body;
    if (
      !input ||
      Object.keys(input).some(
        (key) => !['name', 'description', 'userIds', 'active', 'version'].includes(key),
      ) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 80 ||
      typeof input.description !== 'string' ||
      input.description.length > 1000 ||
      typeof input.active !== 'boolean' ||
      !Array.isArray(input.userIds) ||
      input.userIds.length > 100 ||
      input.userIds.some((id) => typeof id !== 'string' || id.length > 80)
    )
      deny('Invalid approval group.', 400);
    const ids = [...new Set(input.userIds)];
    const eligible = await store.collection('helpdeskMembers').countDocuments({
      ...helpdeskScope(user),
      userId: { $in: ids },
      active: true,
      canApprove: true,
    });
    if (eligible !== ids.length) deny('Choose active users with approval permission.', 400);
    const previous =
      request.params.id && ObjectId.isValid(request.params.id)
        ? await store
            .collection('approvalGroups')
            .findOne({ ...helpdeskScope(user), _id: new ObjectId(request.params.id) })
        : null;
    await requireCompatibleDemoReferences(store, user, previous, { userIds: ids });
    const now = new Date();
    const values = {
      name: input.name.trim(),
      description: input.description.trim(),
      userIds: ids,
      active: input.active,
      updatedAt: now,
    };
    if (request.params.id) {
      if (!ObjectId.isValid(request.params.id) || !Number.isInteger(input.version))
        deny('Invalid group version.', 400);
      const updated = await store.collection('approvalGroups').findOneAndUpdate(
        {
          ...helpdeskScope(user),
          _id: new ObjectId(request.params.id),
          version: queryVersion(input.version),
        },
        { $set: values, $inc: { version: 1 } },
        { returnDocument: 'after' },
      );
      if (!updated) deny('Group changed or is unavailable. Reload before saving.', 409);
      return response.json(present(updated));
    }
    if ((await store.collection('approvalGroups').countDocuments(helpdeskScope(user))) >= 100)
      deny('Group limit reached.', 422);
    const record = {
      ...helpdeskScope(user),
      ...values,
      unifiedVersion: 1,
      approvalEnabled: true,
      assignmentEnabled: false,
      version: 1,
      createdAt: now,
    };
    record._id = (await store.collection('approvalGroups').insertOne(record)).insertedId;
    response.status(201).json(present(record));
  }
  const getApprovalGroups = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const rows = (await workspaceGroups(store, request.helpdeskUser)).filter(
      (group) =>
        group.approvalEnabled !== false &&
        (request.query.reference !== '1' ||
          request.query.includeDemo === '1' ||
          !group.demoDatasetId),
    );
    response.json(
      listResponse(request, rows.map(present), {
        Group: 'name',
        Description: 'description',
        Members: (row) => row.userIds.length,
        Status: (row) => (row.active ? 'Active' : 'Inactive'),
        Updated: (row) => Date.parse(row.updatedAt),
      }),
    );
  };
  const getApprovalGroupsId = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const record =
      ObjectId.isValid(request.params.id) &&
      (await store
        .collection('approvalGroups')
        .findOne({ ...helpdeskScope(request.helpdeskUser), _id: new ObjectId(request.params.id) }));
    if (!record) deny('Group not found.', 404);
    response.json(present(record));
  };
  return { getApprovalGroups, getApprovalGroupsId, save };
}
