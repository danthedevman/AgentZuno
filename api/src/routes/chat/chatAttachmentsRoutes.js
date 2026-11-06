import { createChatAttachmentsController } from '../../controllers/chat/chatAttachmentsController.js';
export function installChatAttachmentRoutes(app, store) {
  const controller = createChatAttachmentsController(store);
  app.post('/api/helpdesk/chat-attachments', controller.postChatAttachments);
}
