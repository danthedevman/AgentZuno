import { createCatalogImagesController } from '../../controllers/workflows/catalogImagesController.js';
export function installCatalogImageRoutes(app, store) {
  const controller = createCatalogImagesController(store);
  app.post('/api/helpdesk/catalog-images', controller.postCatalogImages);
  app.get('/api/helpdesk/catalog-images/:id', controller.getCatalogImagesId);
}
