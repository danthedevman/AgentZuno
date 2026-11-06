import { visibleChatTitle } from '../../chat/chatPresentation.js';

import { readData } from '../../data/data.js';

import { ownerFilter, safeChat } from '../../chat/chat.js';
export function createChatController(store, service) {
  const requireUser = async (request, response, next) => {
    if (!request.user || request.user.isDemo)
      return response
        .status(401)
        .json({ error: 'Sign in with a registered account to use AI chat and provider settings.' });
    await store.ready();
    next();
  };
  const getAiProviders = async (request, response) =>
    response.json(await readData('ai-providers.json'));
  const getSettingsAi = async (request, response) =>
    response.json(await service.ai.settings(request.user));
  const postSettingsAi = async (request, response) =>
    response.json(await service.ai.save(request.user, request.body || {}));
  const getChats = async (request, response) =>
    response.json(
      (
        await store
          .collection('chats')
          .find(ownerFilter(request.user), {
            projection: {
              title: 1,
              updatedAt: 1,
              status: 1,
              ownerId: 1,
              workspaceId: 1,
              requestId: 1,
              helpdeskPurpose: 1,
              helpdeskRequestId: 1,
              messages: { $slice: 1 },
            },
          })
          .sort({ updatedAt: -1 })
          .limit(50)
          .toArray()
      ).map((chat) => ({
        id: chat._id.toHexString(),
        title: visibleChatTitle(chat),
        updatedAt: chat.updatedAt,
        status: chat.status,
      })),
    );
  const postChats = async (request, response) =>
    response.status(202).json(await service.create(request.user, request.body || {}));
  const getChatsId = async (request, response) =>
    response.json(safeChat(await service.get(request.user, request.params.id)));
  const postChatsIdMessages = async (request, response) =>
    response
      .status(202)
      .json(await service.send(request.user, request.params.id, request.body || {}));
  return {
    getAiProviders,
    getSettingsAi,
    postSettingsAi,
    getChats,
    postChats,
    getChatsId,
    postChatsIdMessages,
    requireUser,
  };
}
