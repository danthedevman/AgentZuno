import { rateLimit } from 'express-rate-limit';

import { createSmtpSettingsController } from '../../controllers/channels/smtpSettingsController.js';
export function installSmtpRoutes(app, store) {
  const controller = createSmtpSettingsController(store);
  app.use(
    '/api/helpdesk/smtp/test',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.get('/api/helpdesk/smtp', controller.getSmtp);
  app.put('/api/helpdesk/smtp', controller.putSmtp);
  app.post('/api/helpdesk/smtp/test', controller.postSmtpTest);
}
