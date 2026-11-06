import { createProfilePicturesController } from '../../controllers/identity/profilePicturesController.js';
export function installProfilePictureRoutes(app, store) {
  const controller = createProfilePicturesController(store);
  app.put('/api/helpdesk/profile-picture', controller.putProfilePicture);
  app.delete('/api/helpdesk/profile-picture', controller.deleteProfilePicture);
  app.get('/api/helpdesk/profile-pictures/:id', controller.getProfilePicturesId);
}
