import { ObjectId } from 'mongodb';
import { canUseWorkflow } from '../../sdk/workflows/index.js';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { queryString } from '../shared/queryValues.js';
import { matchesWorkflowDepartment } from './workflowDepartments.js';

const scope = (user) => ({
  ownerId: queryString(helpdeskScope(user).ownerId, 80),
  workspaceId: queryString(user.workspaceId, 80),
});
function selection(record) {
  const published = record.publishedConfig || record;
  return {
    workflowId: String(record._id),
    workflowVersion: record.publishedRevision || record.version,
    name: published.name,
    description: published.definition?.settings?.description || '',
    form: published.definition.form,
  };
}
async function permitted(store, user, record) {
  const definition = (record?.publishedConfig || record)?.definition;
  return (
    !!definition?.form &&
    canUseWorkflow(definition, user) &&
    (await matchesWorkflowDepartment(store, user, definition))
  );
}
export async function requestWorkflowChoices(store, user) {
  if (user.role === 'read-only') return [];
  const records = await store
    .collection('helpdeskWorkflows')
    .find({ ...scope(user), enabled: true })
    .sort({ name: 1, _id: 1 })
    .limit(100)
    .toArray();
  const choices = [];
  for (const record of records)
    if (await permitted(store, user, record)) choices.push(selection(record));
  return choices;
}
export async function selectedRequestWorkflow(store, user, id, version) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id))
    deny('Choose a valid published workflow.', 400);
  if (user.role === 'read-only') deny();
  const record = await store.collection('helpdeskWorkflows').findOne({
    ...scope(user),
    _id: new ObjectId(queryString(id, 24)),
    enabled: true,
  });
  if (!(await permitted(store, user, record))) deny('Request workflow is unavailable.', 404);
  const result = selection(record);
  if (version !== undefined && result.workflowVersion !== version)
    deny('This request form changed. Ask for the current form.', 409);
  return result;
}
