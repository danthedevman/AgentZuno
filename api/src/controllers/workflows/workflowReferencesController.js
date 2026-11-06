import { ObjectId } from 'mongodb';

import { helpdeskScope, deny } from '../../identity/helpdeskRoles.js';
import { canUseWorkflow } from '../../../sdk/workflows/index.js';
import { matchesWorkflowDepartment } from '../../workflows/workflowDepartments.js';
import { workflowReferenceOptions } from '../../workflows/workflowReferences.js';
export function createWorkflowReferencesController(store) {
  const getWorkflowsIdFormReferencesFieldId = async (request, response) => {
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
  };
  return { getWorkflowsIdFormReferencesFieldId };
}
