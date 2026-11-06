import { createWorkflowExecutionController } from '../../controllers/workflows/workflowExecutionController.js';
export function installWorkflowExecutionRoutes(app, store) {
  const controller = createWorkflowExecutionController(store);
  app.get('/api/helpdesk/workflow-runs', controller.getWorkflowRuns);
  app.get('/api/helpdesk/my-approvals', controller.getMyApprovals);
  app.post('/api/helpdesk/workflow-runs/:id/decisions', controller.postWorkflowRunsIdDecisions);
}
