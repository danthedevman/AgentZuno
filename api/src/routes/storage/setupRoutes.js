import { rateLimit } from 'express-rate-limit';
import express from 'express';

import { initializeInstallation } from '../../storage/configuration.js';

import { createSetupController } from '../../controllers/storage/setupController.js';
export function installDatabaseSetupRoutes(app) {
  const controller = createSetupController();
  initializeInstallation();
  app.get('/api/installation/database', controller.getInstallationDatabase);
  app.post(
    '/api/installation/database',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many setup attempts. Try again in a minute.' },
    }),
    express.json({ limit: '8kb' }),
    controller.postInstallationDatabase,
  );
}
