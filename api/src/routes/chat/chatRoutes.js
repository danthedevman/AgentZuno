import { createChatController } from '../../controllers/chat/chatController.js';
export function installChatRoutes(app, store, service) {
  const controller = createChatController(store, service);
  app.get('/api/ai-providers', controller.getAiProviders);
  app.get('/api/settings/ai', controller.requireUser, controller.getSettingsAi);
  app.post('/api/settings/ai', controller.requireUser, controller.postSettingsAi);
  app.get('/api/chats', controller.requireUser, controller.getChats);
  app.post('/api/chats', controller.requireUser, controller.postChats);
  app.get('/api/chats/:id', controller.requireUser, controller.getChatsId);
  app.post('/api/chats/:id/messages', controller.requireUser, controller.postChatsIdMessages);
}
