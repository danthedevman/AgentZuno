import { createInvitationsController } from '../../controllers/identity/invitationsController.js';
export function installInvitationRoutes(app, store) {
  const controller = createInvitationsController(store);
  app.post('/api/helpdesk/invitations', controller.postInvitations);
  app.get('/api/helpdesk/invitations', controller.getInvitations);
  app.post('/api/helpdesk/invitations/:id/resend', controller.postInvitationResend);
  app.delete('/api/helpdesk/invitations/:id', controller.deleteInvitation);
  app.post('/api/helpdesk/invitations/accept', controller.postInvitationsAccept);
}
