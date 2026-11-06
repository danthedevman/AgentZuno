import { ObjectId } from 'mongodb';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { queryString, queryVersion } from '../shared/queryValues.js';
import { bulkDeleteRecords } from '../records/bulkDeletion.js';
import { archiveWorkflowVersion } from './workflowVersions.js';
import { auditOperation } from '../audit/audit.js';

export async function deleteWorkflow(store, user, id, input) {
  if (user.role !== 'admin') deny();
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) deny('Invalid workflow.', 400);
  if (
    !input ||
    Object.keys(input).some(
      (key) =>
        !['confirmed', 'name', 'version', 'preserveRequests', 'preserveHistory'].includes(key),
    ) ||
    input.confirmed !== true ||
    typeof input.name !== 'string' ||
    !input.name ||
    input.name.length > 80 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    typeof input.preserveRequests !== 'boolean' ||
    typeof input.preserveHistory !== 'boolean'
  )
    deny('Confirm the workflow name, version, and preservation choices.', 400);
  const scope = helpdeskScope(user);
  const filter = { ...scope, _id: new ObjectId(queryString(id, 24)) };
  const workflow = await store.collection('helpdeskWorkflows').findOne(filter);
  if (!workflow) deny('Workflow not found.', 404);
  if (workflow.name !== input.name || workflow.version !== input.version)
    deny('Workflow changed. Reload before deleting.', 409);
  const related = { ...scope, workflowId: queryString(id, 24) };
  if (
    await store
      .collection('workflowRuns')
      .findOne({ ...related, status: { $in: ['running', 'delivery-unknown'] } })
  )
    deny(
      'This workflow has an active or uncertain action. Wait for it to finish or review its delivery state before deleting.',
      409,
    );
  return auditOperation(
    store,
    user,
    'workflow.deleted',
    `/workflows/${id}`,
    async () => {
      if (input.preserveHistory) {
        await archiveWorkflowVersion(store, workflow, user.id);
        if (workflow.publishedConfig?.source && workflow.publishedRevision)
          await store
            .collection('workflowRevisions')
            .updateOne(
              { ...related, revision: queryVersion(workflow.publishedRevision) },
              { $setOnInsert: { config: workflow.publishedConfig, createdAt: new Date() } },
              { upsert: true },
            );
      }
      const deleted = await store
        .collection('helpdeskWorkflows')
        .deleteOne({
          ...filter,
          version: queryVersion(input.version),
          name: queryString(input.name, 80),
        });
      if (!deleted.deletedCount) deny('Workflow changed. Reload before deleting.', 409);
      // Removing the authoritative workflow prevents new offers and future run actions.
      await store.collection('workflowRuns').updateMany(
        { ...related, status: { $nin: ['complete', 'failed'] } },
        {
          $set: {
            status: 'failed',
            error: 'Workflow deleted by an administrator.',
            updatedAt: new Date(),
          },
          $unset: { lease: '', leaseUntil: '' },
        },
      );
      let deletedRequests = 0;
      if (!input.preserveRequests) {
        while (true) {
          const requests = await store
            .collection('helpdeskRequests')
            .find(related, { projection: { _id: 1 } })
            .limit(100)
            .toArray();
          if (!requests.length) break;
          const result = await bulkDeleteRecords(store, user, 'requests', {
            confirmed: true,
            ids: requests.map((record) => String(record._id)),
          });
          deletedRequests += result.deletedCount;
        }
      } else {
        await store.collection('helpdeskRequests').updateMany(
          { ...related, status: 'waiting-for-approval' },
          {
            $set: { status: 'open', approvalUserIds: [], updatedAt: new Date() },
            $inc: { version: 1 },
          },
        );
      }
      if (!input.preserveHistory) {
        for (const name of ['workflowRuns', 'workflowRevisions', 'workflowVersions'])
          await store.collection(name).deleteMany(related);
      }
      await store.collection('workflowConversationViews').deleteMany(related);
      return {
        deleted: true,
        deletedCount: 1,
        deletedRequests,
        preserveRequests: input.preserveRequests,
        preserveHistory: input.preserveHistory,
      };
    },
    {
      workflowId: id,
      workflowName: workflow.name,
      versionBefore: workflow.version,
      changedFields: ['deleted', 'preserveRequests', 'preserveHistory'],
    },
  );
}
