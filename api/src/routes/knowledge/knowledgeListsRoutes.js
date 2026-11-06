import { createKnowledgeListsController } from '../../controllers/knowledge/knowledgeListsController.js';
export function installKnowledgeListRoutes(app, loadWorkspace) {
  const controller = createKnowledgeListsController(loadWorkspace);
  app.get('/api/helpdesk/knowledge-bases/:id', controller.getKnowledgeBasesId);
  app.get('/api/helpdesk/lists/:kind', controller.getListsKind);
}
