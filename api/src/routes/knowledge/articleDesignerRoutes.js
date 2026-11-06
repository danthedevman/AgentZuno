import { createArticleDesignerController } from '../../controllers/knowledge/articleDesignerController.js';
export function installArticleDesignerRoutes(app, store, content, chats, saveArticle) {
  const controller = createArticleDesignerController(store, content, chats, saveArticle);
  app.get('/api/helpdesk/article-conversations', controller.getArticleConversations);
  app.post('/api/helpdesk/article-conversations', controller.postArticleConversations);
  app.get('/api/helpdesk/article-conversations/:id', controller.getArticleConversationsId);
  app.post(
    '/api/helpdesk/article-conversations/:id/messages',
    controller.postArticleConversationsIdMessages,
  );
  app.post('/api/helpdesk/article-proposals', controller.postArticleProposals);
  app.get('/api/helpdesk/article-proposals/:id', controller.getArticleProposalsId);
  app.post('/api/helpdesk/article-proposals/:id/approve', controller.postArticleProposalsIdApprove);
}
