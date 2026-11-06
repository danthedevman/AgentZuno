import { createKnowledgeAnalyticsController } from '../../controllers/knowledge/knowledgeAnalyticsController.js';
export function installKnowledgeAnalyticsRoutes(app, store, service) {
  const controller = createKnowledgeAnalyticsController(store, service);
  app.get('/api/knowledge/overview', controller.getKnowledgeOverview);
  app.post('/api/knowledge/views', controller.postKnowledgeViews);
  app.patch('/api/topics/:id', controller.patchTopicsId);
  app.post('/api/topics', controller.postTopics);
}
