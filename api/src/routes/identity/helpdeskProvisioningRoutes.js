import { createHelpdeskProvisioningController } from '../../controllers/identity/helpdeskProvisioningController.js';
export function installProvisioningRoutes(app, store) {
  const controller = createHelpdeskProvisioningController(store);
  app.get('/api/helpdesk/provisioning', controller.getProvisioning);
  app.get('/api/helpdesk/directory-users', controller.getDirectoryUsers);
  app.post('/api/helpdesk/provisioning/token', controller.postProvisioningToken);
  app.use('/api/provisioning/:workspaceId/scim/v2', controller.useApiProvisioningWorkspaceIdScimV2);
  app.get(`${controller.root}/ServiceProviderConfig`, controller.getRootServiceProviderConfig);
  app.get(`${controller.root}/Users`, controller.getRootUsers);
  app.post(`${controller.root}/Users`, controller.postRootUsers);
  app.get(`${controller.root}/Users/:id`, controller.getRootUsersId);
  app.put(`${controller.root}/Users/:id`, controller.putRootUsersId);
  app.patch(`${controller.root}/Users/:id`, controller.patchRootUsersId);
  app.delete(`${controller.root}/Users/:id`, controller.deleteRootUsersId);
}
