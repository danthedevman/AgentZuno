import { installArticleDesignerRoutes } from './articleDesignerRoutes.js';

import { createContentController } from '../../controllers/knowledge/contentController.js';
export function installContentRoutes(app, auth, store, designer = {}) {
  const controller = createContentController(auth, store, designer);
  app.post('/api/uploads/images', controller.requireUser, controller.postUploadsImages);
  app.get('/api/uploads/images/:id', controller.requireUser, controller.getUploadsImagesId);
  app.post('/api/uploads/files', controller.requireUser, controller.postUploadsFiles);
  app.get('/api/uploads/files/:id', controller.requireUser, controller.getUploadsFilesId);
  app.get('/api/records/:type/:id', controller.requireUser, controller.getRecordsTypeId);
  app.post('/api/records/:type', controller.requireUser, controller.saveRecord);
  app.patch('/api/records/:type/:id', controller.requireUser, controller.saveRecord);
  app.patch('/api/articles/:id/status', controller.requireUser, controller.patchArticlesIdStatus);
  if (designer.chats)
    installArticleDesignerRoutes(
      app,
      designer.integrations,
      store,
      designer.chats,
      controller.saveArticle,
    );
  app.post('/api/articles', controller.requireUser, controller.saveArticle);
  app.patch('/api/articles/:id', controller.requireUser, controller.saveArticle);
}
