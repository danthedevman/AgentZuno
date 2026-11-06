import { rateLimit } from 'express-rate-limit';

import { createArticleAttachmentsController } from '../../controllers/knowledge/articleAttachmentsController.js';
export function installArticleAttachmentRoutes(app, store) {
  const controller = createArticleAttachmentsController(store);
  app.use(
    [
      '/api/helpdesk/article-attachment-list/:id',
      '/api/helpdesk/article-attachments/:id',
      '/api/helpdesk/article-attachments',
    ],
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.post('/api/helpdesk/article-attachments', controller.postArticleAttachments);
  app.get('/api/helpdesk/article-attachment-list/:id', controller.getArticleAttachmentListId);
  app.get('/api/helpdesk/article-attachments/:id', controller.getArticleAttachmentsId);
}
