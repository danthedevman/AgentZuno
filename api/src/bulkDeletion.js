import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { deny, helpdeskScope, requireRole } from './helpdeskRoles.js';

export async function bulkDeleteRecords(store, user, kind, input) {
  requireRole(user, ['admin']);
  if (!['requests', 'articles'].includes(kind)) deny('Unknown record type.', 400);
  if (
    !input ||
    Object.keys(input).some((key) => !['ids', 'confirmed'].includes(key)) ||
    input.confirmed !== true ||
    !Array.isArray(input.ids) ||
    !input.ids.length ||
    input.ids.length > 100 ||
    input.ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) ||
    new Set(input.ids).size !== input.ids.length
  )
    deny('Confirm a selection of 1–100 records.', 400);
  const scope = helpdeskScope(user);
  const filter = {
    ...(kind === 'articles' ? { ownerId: scope.ownerId } : scope),
    _id: { $in: input.ids.map((id) => new ObjectId(id)) },
  };
  const collection = store.collection(kind === 'requests' ? 'helpdeskRequests' : 'articles');
  const records = await collection.find(filter).toArray();
  if (records.length !== input.ids.length || records.some((record) => record.sourceConnectionId))
    deny('One or more selected records cannot be deleted.', 404);
  if (
    kind === 'requests' &&
    (await store.collection('workflowRuns').findOne({
      ...scope,
      requestId: { $in: input.ids },
      status: { $in: ['running', 'delivery-unknown'] },
    }))
  )
    deny(
      'A selected request has an active or uncertain workflow action. Wait for it to finish or review its delivery state before deleting.',
      409,
    );
  // Keep governance and run history. Removing the authoritative record denies future reads/actions.
  for (const record of records) {
    if (kind === 'articles')
      await store.collection('authoredSemanticRetirements').updateOne(
        { _id: String(record._id), ...scope },
        {
          $set: { ...scope, status: 'Pending', generation: randomUUID(), updatedAt: new Date() },
        },
        { upsert: true },
      );
    await collection.deleteOne({ ...filter, _id: record._id });
    if (kind === 'requests') {
      await store
        .collection('helpdeskTasks')
        .deleteMany({ ...scope, requestId: String(record._id) });
      await store
        .collection('requestAttachments')
        .deleteMany({ ...scope, requestId: String(record._id) });
      await store.collection('workflowRuns').updateMany(
        {
          ...scope,
          requestId: String(record._id),
          status: { $nin: ['complete', 'failed'] },
        },
        {
          $set: {
            status: 'failed',
            error: 'Request deleted by an administrator.',
            updatedAt: new Date(),
          },
          $unset: { lease: '', leaseUntil: '' },
        },
      );
    } else {
      await store
        .collection('knowledgePermissions')
        .deleteMany({ ...scope, kind: 'article', resourceId: String(record._id) });
      // Attachments may be shared by another article; remove only unreferenced uploads.
      for (const id of record.attachmentIds || []) {
        if (!ObjectId.isValid(id)) continue;
        if (!(await collection.findOne({ ownerId: scope.ownerId, attachmentIds: id })))
          await store.collection('articleAttachments').deleteOne({
            ownerId: scope.ownerId,
            workspaceId: scope.workspaceId,
            _id: new ObjectId(id),
          });
      }
    }
  }
  return { deletedCount: records.length };
}
export function installBulkDeletionRoutes(app, store) {
  for (const kind of ['requests', 'articles'])
    app.post(`/api/helpdesk/${kind}/bulk-delete`, async (request, response) => {
      response.json(await bulkDeleteRecords(store, request.helpdeskUser, kind, request.body));
    });
}
