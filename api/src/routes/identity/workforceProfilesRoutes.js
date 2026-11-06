import { createWorkforceProfilesController } from '../../controllers/identity/workforceProfilesController.js';
export function installWorkforceRoutes(app, store) {
  const controller = createWorkforceProfilesController(store);
  app.get('/api/helpdesk/workforce-profiles', controller.getWorkforceProfiles);
  app.get('/api/helpdesk/workforce-profiles/:id', controller.getWorkforceProfilesId);
  app.get('/api/helpdesk/reference-records', controller.getReferenceRecords);
  app.post('/api/helpdesk/reference-records', controller.postReferenceRecords);
  app.put('/api/helpdesk/workforce-profiles/:id/cover', controller.putWorkforceProfilesIdCover);
  app.put('/api/helpdesk/workforce-profiles/:id', controller.putWorkforceProfilesId);
}
