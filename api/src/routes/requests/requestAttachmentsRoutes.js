import { createRequestAttachmentsController } from '../../controllers/requests/requestAttachmentsController.js';
export function installRequestAttachmentRoutes(app, store, service) {
  const controller = createRequestAttachmentsController(store, service);
  app.get(
    '/api/helpdesk/request-attachments/:requestId',
    controller.getRequestAttachmentsRequestId,
  );
  app.post(
    '/api/helpdesk/request-attachments/:requestId',
    controller.postRequestAttachmentsRequestId,
  );
  app.get(
    '/api/helpdesk/request-attachments/:requestId/:fileId',
    controller.getRequestAttachmentsRequestIdFileId,
  );
}
