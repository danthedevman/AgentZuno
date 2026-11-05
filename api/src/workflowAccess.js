import { ObjectId } from 'mongodb';
import { helpdeskScope, resolveHelpdeskUser, deny } from './helpdeskRoles.js';
import { matchesWorkflowDepartment } from './workflowDepartments.js';
import { canUseWorkflow } from '../sdk/workflows/index.js';
export async function authorizeWorkflowRun(store, run) {
  const account = await store.collection('users').findOne({ id: run.actorId });
  if (!account) deny('Workflow requester is unavailable.');
  const actor = await resolveHelpdeskUser(store, account, run.workspaceId);
  if (helpdeskScope(actor).ownerId !== run.ownerId) deny();
  const workflow = await store.collection('helpdeskWorkflows').findOne({
    _id: new ObjectId(run.workflowId),
    ownerId: run.ownerId,
    workspaceId: run.workspaceId,
    enabled: true,
  });
  if (
    !workflow ||
    !(await matchesWorkflowDepartment(store, actor, run.definition)) ||
    !(await matchesWorkflowDepartment(store, actor, workflow.publishedConfig.definition)) ||
    !canUseWorkflow(run.definition, actor) ||
    !canUseWorkflow(workflow.publishedConfig.definition, actor)
  )
    deny('Workflow access changed.');
  return actor;
}
