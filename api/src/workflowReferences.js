import { ObjectId } from 'mongodb';
import { createAdminData } from './adminData.js';
import { helpdeskScope, requestScope, deny } from './helpdeskRoles.js';
import { canUseWorkflow } from '../sdk/workflows/index.js';
import { matchesWorkflowDepartment } from './workflowDepartments.js';

export async function validateWorkflowReferences(store, user, definition) {
  const fields = (definition?.form?.fields || []).filter((field) => field.type === 'reference');
  if (!fields.length) return;
  const tables = await createAdminData(store).tables(user);
  for (const field of fields)
    if (
      field.referenceTable !== 'users' &&
      !tables.some((table) => table.id === field.referenceTable)
    )
      deny('Choose an existing reference table from this workspace.', 400);
}
export async function workflowReferenceOptions(
  store,
  user,
  workflow,
  field,
  query = '',
  selectedId,
) {
  if (field.type !== 'reference') deny('Reference field not found.', 404);
  const table = field.referenceTable;
  // Publishing a reference grants lookup labels/IDs, not access to entire records.
  let options = await createAdminData(store).options(
    { ...user, role: 'admin' },
    table,
    Boolean(workflow.demoDatasetId),
  );
  if (user.role !== 'admin' && user.role !== 'read-only') {
    if (['ref-request', 'ref-task'].includes(table)) {
      const requests = await store
        .collection('helpdeskRequests')
        .find(requestScope(user), { projection: { _id: 1 } })
        .toArray();
      const ids = new Set(requests.map((record) => String(record._id)));
      if (table === 'ref-task') {
        const tasks = await store
          .collection('helpdeskTasks')
          .find(
            { ...helpdeskScope(user), requestId: { $in: [...ids] } },
            { projection: { _id: 1 } },
          )
          .toArray();
        ids.clear();
        for (const task of tasks) ids.add(String(task._id));
      }
      options = options.filter((option) => ids.has(String(option.value)));
    }
    if (table === 'ref-workflow') {
      const workflows = await store
        .collection('helpdeskWorkflows')
        .find({ ...helpdeskScope(user), enabled: true })
        .toArray();
      const ids = new Set(
        workflows
          .filter((record) =>
            canUseWorkflow((record.publishedConfig || record).definition || {}, user),
          )
          .map((record) => String(record._id)),
      );
      options = options.filter((option) => ids.has(String(option.value)));
    }
  }
  const lower = String(query).trim().toLowerCase();
  return options
    .filter(
      (option) =>
        (!selectedId || option.value === selectedId) &&
        (!lower || option.label.toLowerCase().includes(lower)),
    )
    .slice(0, selectedId ? 1 : 30)
    .map((option) => ({
      value: option.value,
      label: ['users', 'ref-user'].includes(table)
        ? option.name || option.label.split(' (')[0]
        : option.label,
      ...(user.role === 'admin' || user.role === 'read-only' ? { href: option.href } : {}),
    }));
}
export async function validateWorkflowReferenceAnswers(store, user, workflow, answers) {
  for (const field of workflow.definition?.form?.fields || []) {
    const answer = answers.find((item) => item.id === field.id);
    if (field.type !== 'reference' || !answer?.value) continue;
    const [option] = await workflowReferenceOptions(store, user, workflow, field, '', answer.value);
    if (!option) deny(`Choose an available ${field.label}.`, 400);
    answer.displayValue = option.label;
    answer.reference = { table: field.referenceTable, id: answer.value };
  }
  return answers;
}
export function installWorkflowReferenceRoutes(app, store) {
  app.get('/api/helpdesk/workflows/:id/form-references/:fieldId', async (request, response) => {
    const user = request.helpdeskUser;
    const record =
      ObjectId.isValid(request.params.id) &&
      (await store
        .collection('helpdeskWorkflows')
        .findOne({ ...helpdeskScope(user), _id: new ObjectId(request.params.id), enabled: true }));
    const workflow = record && { ...record, ...(record.publishedConfig || {}) };
    if (
      !workflow ||
      !canUseWorkflow(workflow.definition || {}, user) ||
      !(await matchesWorkflowDepartment(store, user, workflow.definition))
    )
      deny('Workflow not found.', 404);
    const field = workflow.definition?.form?.fields.find(
      (item) => item.id === request.params.fieldId,
    );
    if (
      !field ||
      typeof (request.query.q || '') !== 'string' ||
      String(request.query.q || '').length > 200
    )
      deny('Reference field not found.', 404);
    response.json(await workflowReferenceOptions(store, user, workflow, field, request.query.q));
  });
}
