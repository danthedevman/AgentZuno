import { ObjectId } from 'mongodb';
import { createAdminData } from './adminData.js';
import { createDataRecordOperations } from './dataRecordOperations.js';
import { helpdeskScope, resolveHelpdeskUser, deny } from './helpdeskRoles.js';

export async function validateWorkflowDataGrants(store, user, definition) {
  const data = createAdminData(store);
  for (const step of (definition.steps || []).filter((step) => step.action.startsWith('data.'))) {
    const table = await data.table(user, step.params.tableId);
    if (step.params.fields.some((id) => !table.fields.some((field) => field.id === id)))
      deny('Choose fields from the selected data table.', 400);
    if (step.action !== 'data.read' && table.sourceManaged)
      deny('Managed system records require their dedicated workflow action.', 400);
    if (step.action === 'data.delete' && step.params.fields.length)
      deny('Delete grants do not expose field values.', 400);
    if (step.params.recordId)
      await createDataRecordOperations(store).read(user, table.id, step.params.recordId);
  }
}
export async function workflowDataActor(store, run, step, input) {
  const account =
    run.publishedBy && (await store.collection('users').findOne({ id: run.publishedBy }));
  if (!account) deny('Republish this workflow to authorize its data actions.');
  const publisher = await resolveHelpdeskUser(store, account, run.workspaceId);
  if (publisher.role !== 'admin' || helpdeskScope(publisher).ownerId !== run.ownerId)
    deny('The workflow publisher no longer has administrator access.');
  const live = await store
    .collection('helpdeskWorkflows')
    .findOne({ ...helpdeskScope(publisher), _id: new ObjectId(run.workflowId), enabled: true });
  const grant = live?.publishedConfig?.definition.steps.find(
    (item) => item.id === step.id && item.action === step.action,
  );
  if (
    !grant ||
    grant.params.tableId !== step.params.tableId ||
    step.params.fields.some((field) => !grant.params.fields.includes(field)) ||
    grant.params.recordId !== step.params.recordId ||
    grant.params.recordIdField !== step.params.recordIdField
  )
    deny('The published data grant changed.');
  if (step.action !== 'data.create') {
    const selected = step.params.recordId || run.input?.answers?.[step.params.recordIdField];
    if (input.recordId !== selected) deny('Record is outside the published workflow grant.');
  }
  return publisher;
}
export async function executeWorkflowDataAction(store, run, step, input) {
  const publisher = await workflowDataActor(store, run, step, input);
  const operations = createDataRecordOperations(store),
    key = `workflow:${run._id}:${step.id}`;
  if (step.action === 'data.read') {
    const record = await operations.read(publisher, input.tableId, input.recordId);
    if (record.demoDatasetId) deny('Real workflow data actions cannot access demo records.');
    return {
      id: record.id,
      version: record.version,
      values: Object.fromEntries(step.params.fields.map((field) => [field, record.values[field]])),
    };
  }
  if (step.action === 'data.delete')
    return operations.prepareDelete(publisher, input.tableId, input.recordId, input.version, key, {
      runId: run._id,
      stepId: step.id,
    });
  return operations.mutate(
    publisher,
    input.tableId,
    step.action.slice(5),
    input.recordId,
    input.values,
    input.version,
    key,
  );
}
