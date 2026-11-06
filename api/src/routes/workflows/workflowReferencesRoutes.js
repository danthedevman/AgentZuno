import { createWorkflowReferencesController } from '../../controllers/workflows/workflowReferencesController.js';
export function installWorkflowReferenceRoutes(app, store) {
  const controller = createWorkflowReferencesController(store);
  app.get(
    '/api/helpdesk/workflows/:id/form-references/:fieldId',
    controller.getWorkflowsIdFormReferencesFieldId,
  );
}
