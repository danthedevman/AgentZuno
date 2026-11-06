import { queryString } from '../shared/queryValues.js';
import {
  createChannelRequestForms,
  slackRequestButton,
  slackRequestModal,
  slackRequestAnswers,
  slackRequestSummary,
} from './channelRequestForms.js';
import { formatSlackReply, slackPortalFooter } from './slackFormatting.js';
import { createSlackUserLinks } from './slackUserLinks.js';
import { requireConnectorAction } from '../integrations/connectorActions.js';
import { requireCurrentChannelApplication } from './channelApplications.js';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { decryptSecret } from '../shared/secrets.js';
import { fetchChannelJson } from './helpdeskChannels.js';
import {
  requireRole,
  helpdeskScope,
  resolveHelpdeskUser,
  deny,
} from '../identity/helpdeskRoles.js';
import { auditOperation } from '../audit/audit.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const directConversationKey = (source, externalUserId, userId) =>
  hash(`${source._id}:${source.slackGeneration}:${externalUserId}:${userId}:direct`);
const slackId = (value, prefixes) =>
  typeof value === 'string' && new RegExp(`^[${prefixes}][A-Z0-9]{2,39}$`).test(value);
export function verifySlackSignature(raw, headers, secret, now = Date.now()) {
  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];
  if (
    !secret ||
    !Buffer.isBuffer(raw) ||
    !/^\d{10}$/.test(timestamp || '') ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature || '')
  )
    deny('Slack request could not be verified.', 401);
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(raw).digest('hex')}`;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
    deny('Slack request could not be verified.', 401);
}
export async function authorizeSlackChat(store, chat) {
  const source =
    ObjectId.isValid(chat.slackSourceId) &&
    (await store.collection('helpdeskChannels').findOne({
      _id: new ObjectId(chat.slackSourceId),
      ownerId: chat.providerOwnerId,
      workspaceId: chat.workspaceId,
      slackGeneration: chat.slackGeneration,
      'bot.enabled': true,
    }));
  if (!source?.credential || (source.expiresAt && new Date(source.expiresAt) <= new Date()))
    deny('Slack connection access changed.', 403);
  await requireConnectorAction(store, source, 'receiveMessages');
  await requireCurrentChannelApplication(store, source);
  const owner = await resolveHelpdeskUser(
    store,
    { id: source.ownerId, workspaceId: source.workspaceId },
    source.workspaceId,
  );
  requireRole(owner, ['admin']);
  const bound =
    source.bot.identityBindings?.find((item) => item.slackUserId === chat.externalSlackUserId)
      ?.userId || null;
  if (bound !== (chat.channelUserId || null)) deny('Slack user identity changed.', 403);
  if (bound) {
    const actor = await resolveHelpdeskUser(
      store,
      { id: bound, workspaceId: source.workspaceId },
      source.workspaceId,
    );
    if (actor.helpdeskOwnerId !== source.ownerId || actor.id !== chat.ownerId)
      deny('Slack user access changed.', 403);
  }
  return source;
}
export function createHelpdeskSlack(store, chats, enqueue = async () => {}, fetcher = fetch) {
  const requestForms = createChannelRequestForms(store, chats);
  async function interact(payload, workspaceId) {
    if (!payload || !slackId(payload.user?.id, 'UW') || !slackId(payload.team?.id, 'T'))
      deny('Invalid Slack interaction.', 400);
    const source = await store.collection('helpdeskChannels').findOne({
      workspaceId: queryString(workspaceId, 24),
      provider: 'slack',
      slackTeamId: queryString(payload.team.id, 40),
      'bot.enabled': true,
    });
    if (!source || (payload.api_app_id && payload.api_app_id !== source.slackAppId))
      deny('Slack access changed.', 403);
    const binding = source.bot.identityBindings?.find(
      (item) => item.slackUserId === payload.user.id,
    );
    if (!binding) deny('Link your workspace account before requesting an item.', 403);
    const actor = await resolveHelpdeskUser(
      store,
      { id: queryString(binding.userId, 80) },
      source.workspaceId,
    );
    await authorizeSlackChat(store, {
      slackSourceId: String(source._id),
      providerOwnerId: source.ownerId,
      workspaceId: source.workspaceId,
      slackGeneration: source.slackGeneration,
      externalSlackUserId: payload.user.id,
      channelUserId: binding.userId,
      ownerId: actor.id,
    });
    await requireConnectorAction(store, source, 'respondToUsers');
    if (
      payload.type === 'block_actions' &&
      payload.actions?.length === 1 &&
      payload.actions[0].action_id === 'agentzuno_continue_dm'
    ) {
      const id = payload.actions[0].value;
      if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) deny('Invalid conversation.', 400);
      const chat = await store.collection('chats').findOne({
        _id: new ObjectId(id),
        ownerId: queryString(actor.id),
        workspaceId: queryString(source.workspaceId),
        providerOwnerId: queryString(source.ownerId),
        slackSourceId: queryString(String(source._id), 24),
        slackGeneration: queryString(source.slackGeneration, 100),
        externalSlackUserId: queryString(payload.user.id, 40),
        helpdeskPurpose: 'slack-support',
      });
      if (!chat) deny('Conversation no longer available.', 404);
      await store.collection('helpdeskSlackDirectConversations').updateOne(
        {
          _id: directConversationKey(source, payload.user.id, actor.id),
        },
        { $set: { chatId: id, expiresAt: new Date(Date.now() + 30 * 60000) } },
        { upsert: true },
      );
      return {};
    }
    if (payload.type === 'block_actions') {
      if (
        payload.actions?.length !== 1 ||
        !['agentzuno_request_open', 'agentzuno_request_confirm'].includes(
          payload.actions[0].action_id,
        ) ||
        typeof payload.trigger_id !== 'string' ||
        payload.trigger_id.length > 500
      )
        return {};
      const { session } = await requestForms.load('slack', source, actor, payload.actions[0].value);
      if (session.fallback) deny('Complete this form in AgentZuno.', 400);
      if (payload.actions[0].action_id === 'agentzuno_request_confirm') {
        if (!session.ready) deny('Complete the form first.', 400);
        const receipt = await requestForms.submit(
          'slack',
          source,
          actor,
          String(session._id),
          session.answers,
        );
        await call(source, 'chat.postEphemeral', {
          channel: payload.channel?.id,
          user: payload.user.id,
          text: `${receipt.number} submitted. Status: ${receipt.status}. ${receipt.url}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'plain_text',
                text: `${receipt.number} submitted. Status: ${receipt.status}.`,
              },
            },
            slackPortalFooter(session.workspaceId),
          ],
          unfurl_links: false,
          unfurl_media: false,
        });
        return {};
      }
      await call(source, 'views.open', {
        trigger_id: payload.trigger_id,
        view: slackRequestModal(session),
      });
      return {};
    }
    if (
      payload.type === 'view_submission' &&
      payload.view?.callback_id === 'agentzuno_request_submit'
    ) {
      const { session } = await requestForms.load(
        'slack',
        source,
        actor,
        payload.view.private_metadata,
      );
      try {
        const receipt = await requestForms.submit(
          'slack',
          source,
          actor,
          String(session._id),
          slackRequestAnswers(session, payload.view.state?.values),
        );
        return {
          response_action: 'update',
          view: {
            type: 'modal',
            title: { type: 'plain_text', text: 'Request Submitted' },
            close: { type: 'plain_text', text: 'Close' },
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'plain_text',
                  text: `${receipt.number} submitted. Status: ${receipt.status}.`,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'View Request' },
                    url: receipt.url,
                  },
                ],
              },
              slackPortalFooter(session.workspaceId),
            ],
          },
        };
      } catch (error) {
        if ([400, 422].includes(error.status))
          return {
            response_action: 'errors',
            errors: { field_0: error.publicMessage || 'Check the form answers and retry.' },
          };
        throw error;
      }
    }
    deny('Unsupported Slack interaction.', 400);
  }

  async function configure(user, input) {
    requireRole(user, ['admin']);
    if (
      !input ||
      Object.keys(input).some((key) => !['enabled', 'identityBindings', 'version'].includes(key)) ||
      !Number.isInteger(input.version) ||
      typeof input.enabled !== 'boolean' ||
      !Array.isArray(input.identityBindings) ||
      input.identityBindings.length > 1000
    )
      deny('Invalid Slack bot settings.', 400);
    const members = await store
      .collection('helpdeskMembers')
      .find({ ...helpdeskScope(user), active: true })
      .toArray();
    const bindings = input.identityBindings.map((item) => {
      if (
        !item ||
        Object.keys(item).some((key) => !['slackUserId', 'userId'].includes(key)) ||
        !slackId(item.slackUserId, 'UW') ||
        typeof item.userId !== 'string' ||
        !members.some((member) => member.userId === item.userId)
      )
        deny('Choose a Slack user ID and active workspace user.', 400);
      return { slackUserId: item.slackUserId, userId: item.userId };
    });
    if (new Set(bindings.map((item) => item.slackUserId)).size !== bindings.length)
      deny('Slack users may only be linked once.', 400);
    const result = await store.collection('helpdeskChannels').updateOne(
      {
        ...helpdeskScope(user),
        provider: 'slack',
        'credential.ciphertext': { $type: 'string' },
        slackScopeVersion: 1,
        'bot.version': input.version,
      },
      {
        $set: {
          'bot.enabled': input.enabled,
          'bot.identityBindings': bindings,
          'bot.updatedAt': new Date(),
        },
        $inc: { 'bot.version': 1 },
      },
    );
    if (!result.matchedCount)
      deny('Install the Slack bot with its current permissions first.', 422);
    return { saved: true };
  }
  async function receive(body, workspaceId) {
    if (
      body?.type === 'url_verification' &&
      typeof body.challenge === 'string' &&
      body.challenge.length <= 1000
    )
      return { challenge: body.challenge };
    if (!slackId(body?.team_id, 'T') || !slackId(body?.api_app_id, 'A')) return { ok: true };
    if (
      body?.type !== 'event_callback' ||
      typeof body.event_id !== 'string' ||
      body.event_id.length > 100
    )
      return { ok: true };
    const source = await store.collection('helpdeskChannels').findOne({
      provider: 'slack',
      ...(workspaceId ? { workspaceId } : {}),
      slackTeamId: body.team_id,
      slackAppId: body.api_app_id,
      slackScopeVersion: 1,
      'bot.enabled': true,
    });
    if (!source?.credential || !slackId(body.team_id, 'T')) return { ok: true };
    try {
      await requireConnectorAction(store, source, 'receiveMessages');
    } catch (error) {
      if (error.status === 403) return { ok: true };
      throw error;
    }
    const event = body.event;
    if (
      !event ||
      !['app_mention', 'message'].includes(event.type) ||
      event.bot_id ||
      event.subtype ||
      !slackId(event.user, 'UW') ||
      event.user === source.slackBotUserId ||
      !slackId(event.channel, 'CGD') ||
      typeof event.text !== 'string' ||
      event.text.length > 8000 ||
      !/^\d{10,16}\.\d{1,6}$/.test(event.ts || '')
    )
      return { ok: true };
    const threadTs = event.thread_ts || event.ts;
    if (!/^\d{10,16}\.\d{1,6}$/.test(threadTs)) return { ok: true };
    const channelUserId =
      source.bot.identityBindings?.find((item) => item.slackUserId === event.user)?.userId || null;
    let key = hash(
      `${source._id}:${source.slackGeneration}:${event.channel}:${event.user}:${threadTs}:${channelUserId || 'unlinked'}`,
    );
    if (event.channel_type === 'im' && channelUserId) {
      const direct = await store.collection('helpdeskSlackDirectConversations').findOne({
        _id: directConversationKey(source, event.user, channelUserId),
        expiresAt: { $gt: new Date() },
      });
      if (direct) {
        const thread = await store.collection('helpdeskSlackThreads').findOne({
          sourceId: source._id,
          generation: queryString(source.slackGeneration, 100),
          actorId: queryString(channelUserId),
          chatId: queryString(direct.chatId, 24),
        });
        if (thread) key = thread._id;
      }
    }
    const known = await store.collection('helpdeskSlackThreads').findOne({ _id: key });
    if (event.type !== 'app_mention' && event.channel_type !== 'im' && !known) return { ok: true };
    const text = event.text.replaceAll(`<@${source.slackBotUserId}>`, '').trim();
    if (!text) return { ok: true };
    const id = hash(
      `${source._id}:${source.slackGeneration}:${event.channel}:${event.ts}:${event.user}`,
    );
    try {
      await store.collection('helpdeskSlackMessages').insertOne({
        _id: id,
        sourceId: source._id,
        ownerId: source.ownerId,
        workspaceId: source.workspaceId,
        generation: source.slackGeneration,
        threadKey: key,
        channelUserId,
        event: {
          text,
          user: event.user,
          channel: event.channel,
          ts: event.ts,
          threadTs,
          isDirect: event.channel_type === 'im',
        },
        status: 'received',
        createdAt: new Date(),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    await enqueue(source).catch(() => {});
    return { ok: true };
  }
  async function call(source, method, body) {
    const credentials = JSON.parse(decryptSecret(source.credential));
    const url = new URL(`https://slack.com/api/${method}`);
    const isLookup = method === 'conversations.info';
    if (isLookup) url.searchParams.set('channel', body.channel);
    const result = await fetchChannelJson(fetcher, url.href, {
      method: isLookup ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        ...(isLookup ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
      },
      ...(isLookup ? {} : { body: JSON.stringify(body) }),
    });
    if (result.ok !== true) deny('Slack did not authorize this operation.', 422);
    return result;
  }
  async function member(source, event) {
    const result = await call(source, 'conversations.info', { channel: event.channel });
    if (
      !result.channel ||
      (event.isDirect ? !result.channel.is_im : result.channel.is_member !== true)
    )
      deny('Invite Zuno to this channel before using it.', 403);
  }
  async function process(source) {
    const lease = randomUUID();
    const current = await store.collection('helpdeskChannels').findOneAndUpdate(
      {
        _id: source._id,
        slackGeneration: source.slackGeneration,
        'bot.enabled': true,
        $or: [{ 'bot.leaseUntil': { $exists: false } }, { 'bot.leaseUntil': { $lt: new Date() } }],
      },
      { $set: { 'bot.lease': lease, 'bot.leaseUntil': new Date(Date.now() + 300000) } },
      { returnDocument: 'after' },
    );
    if (!current) return;
    try {
      await auditOperation(
        store,
        { id: 'zuno-slack', ownerId: source.ownerId, workspaceId: source.workspaceId },
        'slack-bot-processing',
        '/channels/slack',
        async () => {
          const messages = await store
            .collection('helpdeskSlackMessages')
            .find({
              sourceId: source._id,
              generation: source.slackGeneration,
              status: { $in: ['received', 'generating'] },
            })
            .sort({ createdAt: 1 })
            .limit(25)
            .toArray();
          for (const item of messages) {
            await requireConnectorAction(store, current, 'receiveMessages');
            const binding =
              current.bot.identityBindings?.find((value) => value.slackUserId === item.event.user)
                ?.userId || null;
            if (binding !== (item.channelUserId || null)) {
              await store
                .collection('helpdeskSlackMessages')
                .updateOne({ _id: item._id }, { $set: { status: 'access-denied' } });
              continue;
            }
            if (
              binding &&
              binding !== source.ownerId &&
              !(await store.collection('helpdeskMembers').findOne({
                ownerId: source.ownerId,
                workspaceId: source.workspaceId,
                userId: binding,
                active: true,
              }))
            ) {
              await store
                .collection('helpdeskSlackMessages')
                .updateOne({ _id: item._id }, { $set: { status: 'access-denied' } });
              continue;
            }
            const actor = binding
              ? await resolveHelpdeskUser(
                  store,
                  { id: binding, workspaceId: source.workspaceId },
                  source.workspaceId,
                )
              : {
                  id: `slack-${item.threadKey}`,
                  workspaceId: source.workspaceId,
                  helpdeskOwnerId: source.ownerId,
                  role: 'user',
                  queues: [],
                };
            const context = {
              providerOwnerId: source.ownerId,
              assistantType: 'support',
              helpdeskPurpose: 'slack-support',
              slackSourceId: String(source._id),
              slackGeneration: source.slackGeneration,
              externalSlackUserId: item.event.user,
              channelUserId: binding,
            };
            await authorizeSlackChat(store, {
              ...context,
              ownerId: actor.id,
              workspaceId: source.workspaceId,
            });
            await member(current, item.event);
            if (!binding) {
              await requireConnectorAction(store, current, 'respondToUsers');
              const claimed = await store
                .collection('helpdeskSlackMessages')
                .updateOne(
                  { _id: item._id, status: 'received' },
                  { $set: { status: 'sending', sentAttemptAt: new Date() } },
                );
              if (!claimed.matchedCount) continue;
              try {
                const link = await createSlackUserLinks(store).issue(current, item.event.user);
                // Ephemeral responses keep the bearer link private when invoked in a channel.
                await requireCurrentChannelApplication(store, current);
                await requireConnectorAction(store, current, 'respondToUsers');
                await call(
                  current,
                  item.event.isDirect ? 'chat.postMessage' : 'chat.postEphemeral',
                  {
                    channel: item.event.channel,
                    ...(!item.event.isDirect ? { user: item.event.user } : {}),
                    ...(item.event.isDirect ? { thread_ts: item.event.threadTs } : {}),
                    text: `Link your existing AgentZuno account to continue: ${link}\nSign in and confirm. This link expires in 10 minutes.`,
                    mrkdwn: false,
                    parse: 'none',
                    unfurl_links: false,
                    unfurl_media: false,
                  },
                );
                await store
                  .collection('helpdeskSlackMessages')
                  .updateOne({ _id: item._id }, { $set: { status: 'sent', sentAt: new Date() } });
              } catch {
                await store
                  .collection('helpdeskSlackMessages')
                  .updateOne({ _id: item._id }, { $set: { status: 'delivery-unknown' } });
              }
              continue;
            }
            if (item.status === 'received') {
              const thread = await store
                .collection('helpdeskSlackThreads')
                .findOne({ _id: item.threadKey });
              let chat;
              if (thread) {
                const previous = await chats.get(actor, thread.chatId);
                if (!['complete', 'failed'].includes(previous.status)) continue;
                chat = previous.messages.some((message) => message.externalId === item._id)
                  ? previous
                  : await chats.send(
                      actor,
                      thread.chatId,
                      { text: item.event.text },
                      { externalId: item._id },
                    );
              } else {
                const requestId = `${item.threadKey.slice(0, 8)}-${item.threadKey.slice(8, 12)}-${item.threadKey.slice(12, 16)}-${item.threadKey.slice(16, 20)}-${item.threadKey.slice(20, 32)}`;
                chat = await chats.create(actor, { requestId, text: item.event.text }, context);
                await store.collection('helpdeskSlackThreads').updateOne(
                  { _id: item.threadKey },
                  {
                    $setOnInsert: {
                      sourceId: source._id,
                      generation: source.slackGeneration,
                      chatId: chat.id,
                      actorId: actor.id,
                      createdAt: new Date(),
                    },
                  },
                  { upsert: true },
                );
              }
              if (item.event.isDirect) {
                await store.collection('helpdeskSlackDirectConversations').updateOne(
                  {
                    _id: directConversationKey(current, item.event.user, actor.id),
                  },
                  {
                    $set: {
                      chatId: chat.id || String(chat._id),
                      expiresAt: new Date(Date.now() + 30 * 60000),
                    },
                  },
                  { upsert: true },
                );
              }
              const responseId = [...chat.messages]
                .reverse()
                .find((message) => message.role === 'assistant')?.id;
              await store
                .collection('helpdeskSlackMessages')
                .updateOne(
                  { _id: item._id },
                  { $set: { chatId: chat.id, responseId, status: 'generating' } },
                );
              continue;
            }
            const chat = await store.collection('chats').findOne({
              _id: new ObjectId(item.chatId),
              ownerId: actor.id,
              workspaceId: source.workspaceId,
              helpdeskPurpose: 'slack-support',
            });
            if (!chat || !['complete', 'failed'].includes(chat.status)) continue;
            await authorizeSlackChat(store, chat);
            const reply =
              chat.status === 'failed'
                ? {
                    text: 'I couldn’t complete this response. Please try again, or open AgentZuno to continue.',
                  }
                : chat.messages.find(
                    (message) =>
                      message.id === item.responseId &&
                      message.role === 'assistant' &&
                      message.status === 'complete',
                  );
            if (!reply?.text) continue;
            try {
              await requireConnectorAction(store, source, 'respondToUsers');
            } catch (error) {
              if (error.status === 403) continue;
              throw error;
            }
            const formOffer =
              actor.role !== 'read-only' && chat.status === 'complete'
                ? await requestForms.offer(
                    'slack',
                    current,
                    actor,
                    chat.messages
                      .filter((message) => message.role === 'user')
                      .map((message) => message.text)
                      .join('\n'),
                    `${chat._id}:${item.responseId}`,
                    reply.proposals?.channelRequest,
                  )
                : null;
            const claimed = await store
              .collection('helpdeskSlackMessages')
              .updateOne(
                { _id: item._id, status: 'generating' },
                { $set: { status: 'sending', sentAttemptAt: new Date() } },
              );
            if (!claimed.matchedCount) continue;
            try {
              await auditOperation(
                store,
                { id: 'zuno-slack', ownerId: source.ownerId, workspaceId: source.workspaceId },
                'slack-reply',
                `/slack/messages/${item._id}`,
                async () => {
                  const authorized = await authorizeSlackChat(store, chat);
                  await member(authorized, item.event);
                  await requireConnectorAction(store, authorized, 'respondToUsers');
                  await call(
                    authorized,
                    item.event.isDirect ? 'chat.postMessage' : 'chat.postEphemeral',
                    {
                      channel: item.event.channel,
                      ...(!item.event.isDirect ? { user: item.event.user } : {}),
                      ...(item.event.isDirect ? { thread_ts: item.event.threadTs } : {}),
                      blocks: [
                        ...formatSlackReply(reply.text)
                          .match(/[\s\S]{1,2800}/g)
                          .map((text) => ({
                            type: 'section',
                            text: { type: 'mrkdwn', text },
                          })),
                        ...(formOffer
                          ? [
                              slackRequestSummary(formOffer),
                              slackRequestButton(formOffer, requestForms.portal),
                            ]
                          : []),
                        ...(!item.event.isDirect
                          ? [
                              {
                                type: 'actions',
                                elements: [
                                  {
                                    type: 'button',
                                    text: { type: 'plain_text', text: 'Continue in DM' },
                                    action_id: 'agentzuno_continue_dm',
                                    value: String(chat._id),
                                    url: `https://slack.com/app_redirect?app=${encodeURIComponent(current.slackAppId)}&team=${encodeURIComponent(current.slackTeamId)}`,
                                  },
                                ],
                              },
                            ]
                          : []),
                        slackPortalFooter(chat.workspaceId),
                      ],
                      text: formatSlackReply(reply.text),
                      mrkdwn: true,
                      parse: 'none',
                      unfurl_links: false,
                      unfurl_media: false,
                    },
                  );
                },
              );
              await store
                .collection('helpdeskSlackMessages')
                .updateOne({ _id: item._id }, { $set: { status: 'sent', sentAt: new Date() } });
            } catch {
              await store
                .collection('helpdeskSlackMessages')
                .updateOne({ _id: item._id }, { $set: { status: 'delivery-unknown' } });
            }
          }
          await store
            .collection('helpdeskChannels')
            .updateOne(
              { _id: source._id, 'bot.lease': lease },
              { $set: { 'bot.lastCheckedAt': new Date(), 'bot.error': null } },
            );
        },
      );
    } catch {
      await store.collection('helpdeskChannels').updateOne(
        { _id: source._id, 'bot.lease': lease },
        {
          $set: {
            'bot.error':
              'Slack processing needs attention. Check installation, channel membership, linked users and provider availability.',
            'bot.nextAt': new Date(Date.now() + 60000),
          },
        },
      );
    } finally {
      await store
        .collection('helpdeskChannels')
        .updateOne(
          { _id: source._id, 'bot.lease': lease },
          { $unset: { 'bot.lease': '', 'bot.leaseUntil': '' } },
        );
    }
  }
  return { configure, receive, process, interact };
}
