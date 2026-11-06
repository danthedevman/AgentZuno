import { rateLimit } from 'express-rate-limit';

import { createKnowledgeAccessController } from '../../controllers/knowledge/knowledgeAccessController.js';
export function installKnowledgeAccessRoutes(app, store) {
  const controller = createKnowledgeAccessController(store);
  app.use(
    '/api/helpdesk/knowledge-center',
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.get(
    '/api/helpdesk/knowledge-permissions/:kind/:id',
    controller.getKnowledgePermissionsKindId,
  );
  app.put(
    '/api/helpdesk/knowledge-permissions/:kind/:id',
    controller.putKnowledgePermissionsKindId,
  );
  app.get('/api/helpdesk/knowledge-center', controller.getKnowledgeCenter);
}
