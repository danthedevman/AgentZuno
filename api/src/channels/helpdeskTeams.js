import { queryString } from '../shared/queryValues.js';
import {
  createChannelRequestForms,
  teamsRequestCard,
  teamsRequestAnswers,
} from './channelRequestForms.js';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import { channelApplication, requireCurrentChannelApplication } from './channelApplications.js';
import { requireConnectorAction } from '../integrations/connectorActions.js';
import { fetchChannelJson as readChannelJson } from './helpdeskChannels.js';
import {
  helpdeskScope,
  resolveHelpdeskUser,
  requireRole,
  deny,
} from '../identity/helpdeskRoles.js';
import { auditOperation } from '../audit/audit.js';
import { verifyTeamsActivity, teamsServiceUrl } from './teamsAuthentication.js';
const guid = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const identifier = (value, max = 2000) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !/[\x00-\x1f\x7f]/.test(value);
const idFor = (value) =>
  new ObjectId(createHash('sha256').update(value).digest('hex').slice(0, 24));
export async function authorizeTeamsChat(store, chat) {
  const source =
    ObjectId.isValid(chat.teamsSourceId) &&
    (await store.collection('helpdeskTeamsBots').findOne({
      _id: new ObjectId(chat.teamsSourceId),
      ownerId: chat.providerOwnerId,
      workspaceId: chat.workspaceId,
      enabled: true,
      generation: chat.teamsGeneration,
    }));
  if (
    !source ||
    !source.identityBindings.some(
      (binding) =>
        binding.aadObjectId === chat.externalTeamsUserId && binding.userId === chat.ownerId,
    )
  )
    deny('Teams access changed. Contact your administrator.', 403);
  await requireCurrentChannelApplication(store, source);
  await requireConnectorAction(store, source, 'receiveMessages');
  const actor = await resolveHelpdeskUser(
    store,
    { id: chat.ownerId, workspaceId: chat.workspaceId },
    chat.workspaceId,
  );
  if (helpdeskScope(actor).ownerId !== source.ownerId || actor.role === 'read-only') deny();
  return { source, actor };
}
export function createHelpdeskTeams(store, chats, enqueue = async () => {}, fetcher = fetch) {
  const requestForms = createChannelRequestForms(store, chats);
  const fetchChannelJson = (url, options) => readChannelJson(fetcher, url, options);
  const bots = () => store.collection('helpdeskTeamsBots'),
    events = () => store.collection('helpdeskTeamsEvents');
  async function configure(user, input) {
    requireRole(user, ['admin']);
    if (
      !input ||
      Object.keys(input).some(
        (key) => !['tenantId', 'enabled', 'identityBindings', 'version'].includes(key),
      ) ||
      !guid(input.tenantId) ||
      typeof input.enabled !== 'boolean' ||
      !Number.isSafeInteger(input.version) ||
      input.version < 0 ||
      !Array.isArray(input.identityBindings) ||
      input.identityBindings.length > 200
    )
      deny('Invalid Teams bot settings.', 400);
    const application = await channelApplication(store, user, 'teams');
    if (!guid(application.clientId) || !application.clientSecret)
      deny('Save the Teams app client ID and secret first.', 400);
    const members = await store
      .collection('helpdeskMembers')
      .find({ ...helpdeskScope(user), active: true })
      .toArray();
    const identityBindings = input.identityBindings.map((binding) => {
      if (
        !binding ||
        Object.keys(binding).some((key) => !['aadObjectId', 'userId'].includes(key)) ||
        !guid(binding.aadObjectId) ||
        typeof binding.userId !== 'string' ||
        !members.some((member) => member.userId === binding.userId && member.role !== 'read-only')
      )
        deny('Choose an Entra object ID and an active workspace user.', 400);
      return { aadObjectId: binding.aadObjectId.toLowerCase(), userId: binding.userId };
    });
    if (
      new Set(identityBindings.map((binding) => binding.aadObjectId)).size !==
      identityBindings.length
    )
      deny('Each Teams identity can only be linked once.', 400);
    const scope = helpdeskScope(user),
      previous = await bots().findOne(scope);
    if ((previous?.version || 0) !== input.version)
      deny('Teams settings changed. Reload before saving.', 409);
    const record = {
      ...scope,
      provider: 'teams',
      tenantId: input.tenantId.toLowerCase(),
      clientId: application.clientId,
      applicationVersion: application.version,
      enabled: input.enabled,
      identityBindings,
      generation: randomUUID(),
      version: input.version + 1,
      updatedAt: new Date(),
    };
    if (previous) {
      const result = await bots().updateOne({ ...scope, version: input.version }, { $set: record });
      if (!result.matchedCount) deny('Teams settings changed. Reload before saving.', 409);
    } else {
      try {
        await bots().insertOne({ ...record, createdAt: new Date() });
      } catch (error) {
        if (error.code === 11000) deny('Teams settings changed. Reload before saving.', 409);
        throw error;
      }
    }
    return metadata(await bots().findOne(scope));
  }
  function metadata(source) {
    return {
      tenantId: source?.tenantId || '',
      enabled: source?.enabled === true,
      identityBindings: source?.identityBindings || [],
      version: source?.version || 0,
      eventsUrl: `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/helpdesk/channels/teams/events/${source?.workspaceId || ''}`,
    };
  }
  async function receive(activity, authorization, workspaceId) {
    if (typeof workspaceId !== 'string' || !/^[a-f0-9]{24}$/.test(workspaceId))
      deny('Invalid Teams destination.', 401);
    const source = await bots().findOne({ workspaceId, enabled: true });
    if (!source) deny('Teams bot is not enabled.', 403);
    await verifyTeamsActivity(activity, authorization, source.clientId, fetcher);
    await requireCurrentChannelApplication(store, source);
    await requireConnectorAction(store, source, 'receiveMessages');
    if (
      !guid(activity?.channelData?.tenant?.id) ||
      activity.channelData.tenant.id.toLowerCase() !== source.tenantId
    )
      deny('This Teams tenant is not authorized.', 403);
    if (activity.type !== 'message') return { accepted: true };
    if (
      !identifier(activity.id, 300) ||
      !identifier(activity.conversation?.id) ||
      !guid(activity.from?.aadObjectId) ||
      !identifier(activity.from?.id) ||
      !identifier(activity.recipient?.id) ||
      (!(activity.value?.agentzunoAction === 'submit-request') &&
        typeof activity.text !== 'string') ||
      (typeof activity.text === 'string' && activity.text.length > 12000)
    )
      deny('Invalid Teams activity.', 400);
    const binding = source.identityBindings.find(
      (item) => item.aadObjectId === activity.from.aadObjectId.toLowerCase(),
    );
    if (!binding) deny('Link this Teams identity to an active workspace user.', 403);
    const actor = await resolveHelpdeskUser(
      store,
      { id: binding.userId, workspaceId },
      workspaceId,
    );
    if (helpdeskScope(actor).ownerId !== source.ownerId || actor.role === 'read-only') deny();
    if (
      (await events().countDocuments({
        ownerId: source.ownerId,
        workspaceId,
        aadObjectId: binding.aadObjectId,
        createdAt: { $gt: new Date(Date.now() - 60000) },
      })) >= 30
    )
      deny('Please wait before sending more Teams messages.', 429);
    const isForm = activity.value?.agentzunoAction === 'submit-request';
    if (
      isForm &&
      (activity.conversation.conversationType !== 'personal' ||
        typeof activity.value.sessionId !== 'string' ||
        !/^[a-f0-9]{24}$/.test(activity.value.sessionId) ||
        JSON.stringify(activity.value).length > 48000)
    )
      deny('Invalid request submission.', 400);
    const id = idFor(`${source._id}:${source.generation}:${activity.id}`);
    const text = sanitizeHtml((activity.text || '').replace(/<at\b[^>]*>[\s\S]*?<\/at>/gi, ''), {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();
    if ((!isForm && !text) || text.length > 7000)
      deny('Teams messages must contain 1–7,000 characters.', 400);
    await auditOperation(
      store,
      { ...actor, ownerId: source.ownerId },
      'teams-inbound-message',
      '/teams/events',
      () =>
        events().updateOne(
          { _id: id },
          {
            $setOnInsert: {
              _id: id,
              ownerId: source.ownerId,
              workspaceId,
              sourceId: String(source._id),
              generation: source.generation,
              aadObjectId: binding.aadObjectId,
              userId: actor.id,
              serviceUrl: teamsServiceUrl(activity.serviceUrl),
              conversationId: activity.conversation.id,
              personal: activity.conversation.conversationType === 'personal',
              activityId: activity.id,
              requestId: randomUUID(),
              text,
              ...(isForm ? { requestFormValue: activity.value } : {}),
              status: 'queued',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        ),
      { triggerType: 'support-chat', triggerLabel: 'Verified Teams activity received' },
    );
    await enqueue(source);
    return { accepted: true };
  }
  async function processBot(source) {
    const lease = randomUUID(),
      now = new Date();
    const claimed = await bots().findOneAndUpdate(
      {
        _id: source._id,
        ownerId: source.ownerId,
        workspaceId: source.workspaceId,
        enabled: true,
        generation: source.generation,
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
      },
      { $set: { lease, leaseUntil: new Date(Date.now() + 120000) } },
      { returnDocument: 'after' },
    );
    if (!claimed) return;
    try {
      await requireCurrentChannelApplication(store, claimed);
      await requireConnectorAction(store, claimed, 'receiveMessages');
      const pending = await events()
        .find({
          ownerId: claimed.ownerId,
          workspaceId: claimed.workspaceId,
          sourceId: String(claimed._id),
          generation: claimed.generation,
          status: { $in: ['queued', 'awaiting-chat', 'sending'] },
        })
        .sort({ createdAt: 1, _id: 1 })
        .limit(10)
        .toArray();
      for (const event of pending) {
        const renewed = await bots().updateOne(
          { _id: claimed._id, lease, generation: claimed.generation, enabled: true },
          { $set: { leaseUntil: new Date(Date.now() + 120000) } },
        );
        if (!renewed.matchedCount) break;
        if (event.status === 'sending') {
          await events().updateOne(
            { _id: event._id, status: 'sending' },
            { $set: { status: 'uncertain', updatedAt: new Date() } },
          );
          continue;
        }
        const context = {
          providerOwnerId: claimed.ownerId,
          assistantType: 'support',
          helpdeskPurpose: 'teams-support',
          teamsSourceId: String(claimed._id),
          teamsGeneration: claimed.generation,
          externalTeamsUserId: event.aadObjectId,
        };
        let actor;
        try {
          ({ actor } = await authorizeTeamsChat(store, {
            ...context,
            ownerId: event.userId,
            workspaceId: claimed.workspaceId,
          }));
        } catch (error) {
          if (error.status === 403) {
            await events().updateOne(
              { _id: event._id },
              { $set: { status: 'blocked', updatedAt: new Date() } },
            );
            continue;
          }
          throw error;
        }
        let reply = 'Please message AgentZuno privately in Teams so I can help with your request.';
        let formOffer;
        if (event.requestFormValue) {
          try {
            const { session } = await requestForms.load(
              'teams',
              claimed,
              actor,
              event.requestFormValue.sessionId,
            );
            const receipt = await requestForms.submit(
              'teams',
              claimed,
              actor,
              String(session._id),
              teamsRequestAnswers(session, event.requestFormValue),
            );
            reply = `${receipt.number} submitted. Status: ${receipt.status}. [View Request](${receipt.url})`;
          } catch (error) {
            if (![400, 403, 404, 409, 422].includes(error.status)) throw error;
            reply =
              error.publicMessage || 'The request could not be submitted. Ask for the form again.';
          }
        } else if (event.personal) {
          let chat;
          if (event.chatId) chat = await chats.get(actor, event.chatId);
          else {
            const threadId = idFor(
              `${claimed._id}:${claimed.generation}:${event.userId}:${event.conversationId}`,
            );
            const thread = await store.collection('helpdeskTeamsThreads').findOne({
              _id: threadId,
              ownerId: claimed.ownerId,
              workspaceId: claimed.workspaceId,
            });
            if (thread) {
              const prior = await chats.get(actor, thread.chatId);
              if (['queued', 'processing', 'responding'].includes(prior.status)) continue;
              chat = await chats.send(
                actor,
                thread.chatId,
                { requestId: event.requestId, text: event.text },
                context,
              );
            } else {
              chat = await chats.create(
                actor,
                { requestId: event.requestId, text: event.text },
                context,
              );
              await store.collection('helpdeskTeamsThreads').updateOne(
                { _id: threadId },
                {
                  $setOnInsert: {
                    ownerId: claimed.ownerId,
                    workspaceId: claimed.workspaceId,
                    chatId: chat.id,
                  },
                },
                { upsert: true },
              );
            }
            await events().updateOne(
              { _id: event._id },
              { $set: { chatId: chat.id, status: 'awaiting-chat', updatedAt: new Date() } },
            );
          }
          if (chat.status !== 'complete') {
            if (chat.status === 'failed')
              await events().updateOne(
                { _id: event._id },
                { $set: { status: 'failed', updatedAt: new Date() } },
              );
            continue;
          }
          reply = chat.messages
            .filter((message) => message.role === 'assistant' && message.status === 'complete')
            .at(-1)?.text;
          if (!reply) continue;
          const draft = chat.messages
            .filter((message) => message.role === 'assistant' && message.status === 'complete')
            .at(-1)?.proposals?.channelRequest;
          formOffer = await requestForms.offer(
            'teams',
            claimed,
            actor,
            chat.messages
              .filter((message) => message.role === 'user')
              .map((message) => message.text)
              .join('\n'),
            `${chat.id}:${event.activityId}`,
            draft,
          );
        }
        await authorizeTeamsChat(store, {
          ...context,
          ownerId: event.userId,
          workspaceId: claimed.workspaceId,
        });
        await requireConnectorAction(store, claimed, 'respondToUsers');
        const application = await channelApplication(
          store,
          { id: claimed.ownerId, workspaceId: claimed.workspaceId },
          'teams',
        );
        const token = await fetchChannelJson(
          `https://login.microsoftonline.com/${claimed.tenantId}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'client_credentials',
              client_id: application.clientId,
              client_secret: application.clientSecret,
              scope: 'https://api.botframework.com/.default',
            }).toString(),
          },
          fetcher,
        );
        if (typeof token.access_token !== 'string' || token.access_token.length > 16000)
          deny('Teams token could not be verified.', 502);
        const changed = await events().updateOne(
          { _id: event._id, status: { $in: ['queued', 'awaiting-chat'] } },
          { $set: { status: 'sending', updatedAt: new Date() } },
        );
        if (!changed.matchedCount) continue;
        try {
          const delivered = await auditOperation(
            store,
            { ...actor, ownerId: claimed.ownerId },
            'teams-bot-reply',
            '/teams/messages',
            () =>
              fetchChannelJson(
                `${teamsServiceUrl(event.serviceUrl)}v3/conversations/${encodeURIComponent(event.conversationId)}/activities`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token.access_token}`,
                  },
                  body: JSON.stringify({
                    type: 'message',
                    ...(formOffer
                      ? { attachments: [teamsRequestCard(formOffer, requestForms.portal)] }
                      : {}),
                    textFormat: 'markdown',
                    replyToId: event.activityId,
                    text: reply
                      .replace(
                        /\]\((\/workspace\/[^)\s]+)\)/g,
                        (_, path) =>
                          `](${process.env.APP_ORIGIN || 'http://localhost:3000'}${path})`,
                      )
                      .slice(0, 18000),
                  }),
                },
                fetcher,
              ),
            {
              triggerType: 'support-chat',
              triggerLabel: 'Verified Teams support message',
              sourceChatId: event.chatId || null,
            },
          );
          if (!identifier(delivered.id)) throw new Error('Unconfirmed delivery');
          await events().updateOne(
            { _id: event._id, status: 'sending' },
            {
              $set: { status: 'sent', messageId: delivered.id, updatedAt: new Date() },
              $unset: { requestFormValue: '' },
            },
          );
        } catch {
          // A network error may follow acceptance. Never automatically send this reply again.
          await events().updateOne(
            { _id: event._id, status: 'sending' },
            { $set: { status: 'uncertain', updatedAt: new Date() } },
          );
        }
      }
    } finally {
      await bots().updateOne({ _id: source._id, lease }, { $unset: { lease: '', leaseUntil: '' } });
    }
  }
  return {
    configure,
    receive,
    process: processBot,
    metadata,
    settings: async (user) =>
      metadata({ ...(await bots().findOne(helpdeskScope(user))), workspaceId: user.workspaceId }),
  };
}
