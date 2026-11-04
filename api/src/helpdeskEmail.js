import { requireConnectorAction } from './connectorActions.js';
import { channelApplication, requireCurrentChannelApplication } from './channelApplications.js';
import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { decryptSecret, encryptSecret } from './secrets.js';
import { channelProviders, fetchChannelJson } from './helpdeskChannels.js';
import { createHelpdeskService } from './helpdesk.js';
import { auditOperation } from './audit.js';
import { resolveHelpdeskUser, requireRole, helpdeskScope, deny } from './helpdeskRoles.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
export function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 320 || /[\r\n]/.test(value)) return null;
  const address = (value.match(/<([^<>]+)>$/)?.[1] || value).trim().toLowerCase();
  return emailPattern.test(address) ? address : null;
}
function header(headers, name) {
  return headers?.find((item) => item.name?.toLowerCase() === name)?.value || '';
}
export function normalizeGmail(message) {
  const headers = message.payload?.headers;
  const sender = emailAddress(header(headers, 'from'));
  const replyTo = emailAddress(header(headers, 'reply-to')) || sender;
  let body = '';
  let parts = 0;
  function visit(part, depth = 0) {
    if (!part || depth > 10 || ++parts > 100) return;
    if (part.mimeType === 'text/plain' && part.body?.data && !part.filename)
      body += Buffer.from(part.body.data, 'base64url').toString('utf8');
    for (const child of (part.parts || []).slice(0, 50)) visit(child, depth + 1);
  }
  visit(message.payload);
  return {
    id: message.id,
    threadId: message.threadId,
    sender,
    replyTo,
    subject: header(headers, 'subject').slice(0, 160),
    messageId: header(headers, 'message-id'),
    automatic:
      (!!header(headers, 'auto-submitted') &&
        header(headers, 'auto-submitted').toLowerCase() !== 'no') ||
      /bulk|list|junk/i.test(header(headers, 'precedence')) ||
      !!header(headers, 'list-id'),
    text: body.trim().slice(0, 7000),
    receivedAt: new Date(Number(message.internalDate)),
  };
}
export function normalizeOutlook(message) {
  const headers = message.internetMessageHeaders;
  return {
    id: message.id,
    threadId: message.conversationId,
    sender: emailAddress(message.from?.emailAddress?.address),
    replyTo: emailAddress(
      message.replyTo?.[0]?.emailAddress?.address || message.from?.emailAddress?.address,
    ),
    subject: (message.subject || '').slice(0, 160),
    messageId: message.internetMessageId,
    automatic:
      (!!header(headers, 'auto-submitted') &&
        header(headers, 'auto-submitted').toLowerCase() !== 'no') ||
      /bulk|list|junk/i.test(header(headers, 'precedence')) ||
      !!header(headers, 'list-id'),
    text:
      message.body?.contentType?.toLowerCase() === 'text'
        ? (message.body.content || '').trim().slice(0, 7000)
        : '',
    receivedAt: new Date(message.receivedDateTime),
  };
}
export function gmailReply(message, mailbox, text) {
  if (
    !emailAddress(message.replyTo) ||
    !emailAddress(mailbox) ||
    !/^<[^\s<>\r\n]+>$/.test(message.messageId)
  )
    deny('The email reply headers could not be verified.', 422);
  const subject = `Re: ${message.subject
    .replace(/^re:\s*/i, '')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 160)}`;
  const raw = [
    `From: ${mailbox}`,
    `To: ${message.replyTo}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `In-Reply-To: ${message.messageId}`,
    `References: ${message.messageId}`,
    'Auto-Submitted: auto-replied',
    'X-Auto-Response-Suppress: All',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text)
      .toString('base64')
      .match(/.{1,76}/g)
      .join('\r\n'),
  ].join('\r\n');
  return { threadId: message.threadId, raw: Buffer.from(raw).toString('base64url') };
}
export function createHelpdeskEmail(store, chats, fetcher = fetch) {
  const helpdesk = createHelpdeskService(store, chats);
  const channels = () => store.collection('helpdeskChannels');
  async function configure(user, provider, input) {
    requireRole(user, ['admin']);
    if (
      !['gmail', 'outlook'].includes(provider) ||
      !input ||
      Object.keys(input).some((key) => !['enabled', 'autoReply', 'department'].includes(key)) ||
      typeof input.enabled !== 'boolean' ||
      typeof input.autoReply !== 'boolean' ||
      !['it', 'hr', 'legal', 'finance', 'facilities', 'general'].includes(input.department)
    )
      deny('Choose valid support inbox settings.', 400);
    const source = await channels().findOne({ ...helpdeskScope(user), provider });
    if (!source?.credential || source.emailScopeVersion !== 1 || !source.mailbox)
      deny('Authorize the support mailbox with read and reply permissions first.', 422);
    const update = {
      $set: {
        'email.enabled': input.enabled,
        'email.autoReply': input.autoReply,
        'email.department': input.department,
        'email.updatedAt': new Date(),
      },
    };
    if (input.enabled && !source.email?.enabled) {
      update.$set['email.enabledAt'] = new Date();
      update.$unset = { 'email.cursorAt': '', 'email.nextAt': '', 'email.error': '' };
    }
    const saved = await channels().updateOne(
      { _id: source._id, emailGeneration: source.emailGeneration },
      update,
    );
    if (!saved.matchedCount) deny('Mailbox authorization changed. Reload before saving.', 409);
    return { saved: true };
  }
  async function authorized(source) {
    const current = await channels().findOne({
      _id: source._id,
      ownerId: source.ownerId,
      workspaceId: source.workspaceId,
      'email.enabled': true,
      emailScopeVersion: 1,
      emailGeneration: source.emailGeneration,
    });
    if (!current?.credential) deny('Support mailbox is disabled.', 403);
    await requireConnectorAction(store, current, 'receiveMessages');
    const owner = await resolveHelpdeskUser(
      store,
      { id: source.ownerId, workspaceId: source.workspaceId },
      source.workspaceId,
    );
    requireRole(owner, ['admin']);
    return current;
  }
  async function token(source) {
    await requireCurrentChannelApplication(store, source);
    let credentials = JSON.parse(decryptSecret(source.credential));
    if (!source.expiresAt || new Date(source.expiresAt).getTime() > Date.now() + 60000)
      return credentials.accessToken;
    const item = channelProviders[source.provider];
    const { clientId, clientSecret } = await channelApplication(
      store,
      { id: source.ownerId, workspaceId: source.workspaceId },
      source.provider,
    );
    if (!credentials.refreshToken || !clientId || !clientSecret)
      deny('Reauthorize the support mailbox.', 422);
    const result = await fetchChannelJson(fetcher, item.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
      }).toString(),
    });
    if (
      typeof result.access_token !== 'string' ||
      !result.access_token ||
      result.access_token.length > 16000 ||
      !Number.isFinite(Number(result.expires_in)) ||
      Number(result.expires_in) <= 0 ||
      Number(result.expires_in) > 31536000 ||
      (result.refresh_token !== undefined &&
        (typeof result.refresh_token !== 'string' || result.refresh_token.length > 16000))
    )
      deny('Reauthorize the support mailbox.', 422);
    credentials = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || credentials.refreshToken,
    };
    const updated = await channels().updateOne(
      { _id: source._id, credential: source.credential },
      {
        $set: {
          credential: encryptSecret(JSON.stringify(credentials)),
          expiresAt: new Date(Date.now() + Number(result.expires_in) * 1000),
        },
      },
    );
    if (!updated.matchedCount) deny('Mailbox authorization changed.', 409);
    return credentials.accessToken;
  }
  async function ingest(source, message) {
    await authorized(source);
    if (
      !message.sender ||
      !message.replyTo ||
      message.replyTo !== message.sender ||
      message.sender === source.mailbox ||
      message.automatic ||
      !message.text ||
      !message.id ||
      message.id.length > 1024 ||
      !message.threadId ||
      message.threadId.length > 1024 ||
      !Number.isFinite(message.receivedAt?.getTime()) ||
      message.receivedAt < new Date(source.email.enabledAt)
    )
      return;
    const scope = {
      ownerId: source.ownerId,
      workspaceId: source.workspaceId,
      provider: source.provider,
      generation: source.emailGeneration,
    };
    const key = digest(`${source._id}:${source.emailGeneration}:${message.id}`);
    const existing = await store.collection('helpdeskEmailMessages').findOne({ _id: key });
    if (existing?.chatId) return;
    const threadKey = digest(
      `${source._id}:${source.emailGeneration}:${message.threadId}:${message.sender}`,
    );
    const actor = {
      id: `mail-${threadKey}`,
      workspaceId: source.workspaceId,
      helpdeskOwnerId: source.ownerId,
      role: 'user',
      queues: [],
    };
    let thread = await store.collection('helpdeskEmailThreads').findOne({ _id: threadKey });
    await store.collection('helpdeskEmailMessages').updateOne(
      { _id: key },
      {
        $setOnInsert: {
          ...scope,
          sourceId: source._id,
          threadKey,
          message,
          status: 'received',
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    if (thread) {
      const chat = await chats.get(actor, thread.chatId);
      if (!['complete', 'failed'].includes(chat.status)) return;
    }
    let chat;
    if (!thread) {
      const requestId = `${threadKey.slice(0, 8)}-${threadKey.slice(8, 12)}-${threadKey.slice(12, 16)}-${threadKey.slice(16, 20)}-${threadKey.slice(20, 32)}`;
      const ticket = await helpdesk.create(
        actor,
        {
          requestId,
          title: message.subject || 'Email support request',
          text: message.text,
          department: source.email.department,
        },
        { deferOrigin: true },
      );
      await store.collection('helpdeskRequests').updateOne(
        { _id: new ObjectId(ticket.id), ...helpdeskScope(actor) },
        {
          $set: {
            channel: 'email',
            submittedVia: 'email',
            emailSender: message.sender,
            requesterName: message.sender,
            requesterEmail: message.sender,
          },
        },
      );
      chat = await chats.create(
        actor,
        { requestId, text: message.text },
        {
          providerOwnerId: source.ownerId,
          assistantType: 'support',
          helpdeskPurpose: 'email-support',
          helpdeskRequestId: ticket.id,
          emailSourceId: source._id.toHexString(),
          emailGeneration: source.emailGeneration,
        },
      );
      await store
        .collection('helpdeskRequests')
        .updateOne(
          { _id: new ObjectId(ticket.id), ...helpdeskScope(actor) },
          { $set: { chatId: chat.id } },
        );
      await store.collection('helpdeskEmailThreads').updateOne(
        { _id: threadKey },
        {
          $setOnInsert: {
            ...scope,
            sourceId: source._id,
            chatId: chat.id,
            requestId: ticket.id,
            sender: message.sender,
          },
        },
        { upsert: true },
      );
    } else {
      // An inbound message ID is also a durable deduplication key on chat turns.
      const current = await chats.get(actor, thread.chatId);
      if (current.messages.some((item) => item.externalId === key))
        chat = { id: thread.chatId, messages: current.messages };
      else
        chat = await chats.send(actor, thread.chatId, { text: message.text }, { externalId: key });
    }
    if (thread)
      await store.collection('helpdeskRequests').updateOne(
        {
          _id: new ObjectId(thread.requestId),
          ownerId: source.ownerId,
          workspaceId: source.workspaceId,
          'messages.id': { $ne: key },
        },
        {
          $push: {
            messages: {
              id: key,
              authorId: actor.id,
              role: 'requester',
              text: message.text,
              createdAt: new Date(),
            },
          },
          $inc: { version: 1 },
          $set: { updatedAt: new Date() },
        },
      );
    await store
      .collection('helpdeskEmailMessages')
      .updateOne(
        { _id: key },
        { $set: { chatId: chat.id, responseId: chat.messages.at(-1).id, status: 'generating' } },
      );
  }
  async function poll(source, accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const since = new Date(source.email.cursorAt || source.email.enabledAt);
    let messages;
    if (source.provider === 'gmail') {
      const query = new URLSearchParams({
        maxResults: '25',
        q: `in:inbox after:${Math.floor(since.getTime() / 1000)} -from:me`,
      });
      const listed = await fetchChannelJson(
        fetcher,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
        { headers },
      );
      if (listed.nextPageToken)
        deny(
          'Support inbox backlog exceeds the polling limit. Narrow the inbox before enabling.',
          422,
        );
      messages = [];
      for (const item of (listed.messages || []).slice(0, 25)) {
        if (typeof item.id !== 'string' || item.id.length > 1024) continue;
        messages.push(
          normalizeGmail(
            await fetchChannelJson(
              fetcher,
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`,
              { headers },
            ),
          ),
        );
      }
    } else {
      const query = new URLSearchParams({
        $top: '25',
        $filter: `receivedDateTime ge ${since.toISOString()}`,
        $orderby: 'receivedDateTime asc',
        $select:
          'id,conversationId,from,replyTo,subject,internetMessageId,internetMessageHeaders,body,receivedDateTime',
      });
      const listed = await fetchChannelJson(
        fetcher,
        `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${query}`,
        {
          headers: { ...headers, Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
        },
      );
      if (listed['@odata.nextLink'])
        deny(
          'Support inbox backlog exceeds the polling limit. Narrow the inbox before enabling.',
          422,
        );
      messages = (listed.value || []).slice(0, 25).map(normalizeOutlook);
    }
    messages.sort((a, b) => a.receivedAt - b.receivedAt);
    for (const message of messages) {
      await authorized(source);
      await ingest(source, message);
    }
    // Keep the cursor behind unresolved arrivals so a busy thread is retried after its response.
    const pending = await store
      .collection('helpdeskEmailMessages')
      .find({ sourceId: source._id, generation: source.emailGeneration, status: 'received' })
      .limit(1)
      .toArray();
    if (!pending.length && messages.length)
      await channels().updateOne(
        { _id: source._id },
        {
          $set: {
            'email.cursorAt': new Date(
              Math.max(
                since.getTime(),
                ...messages.map((item) => item.receivedAt.getTime()).filter(Number.isFinite),
              ) - 1000,
            ),
          },
        },
      );
  }
  async function deliver(source, accessToken) {
    const pending = await store
      .collection('helpdeskEmailMessages')
      .find({ sourceId: source._id, generation: source.emailGeneration, status: 'generating' })
      .sort({ createdAt: 1 })
      .limit(25)
      .toArray();
    for (const item of pending) {
      const thread = await store
        .collection('helpdeskEmailThreads')
        .findOne({ _id: item.threadKey });
      const chat = await store.collection('chats').findOne({
        _id: new ObjectId(item.chatId),
        workspaceId: source.workspaceId,
        providerOwnerId: source.ownerId,
        helpdeskPurpose: 'email-support',
      });
      if (!chat || !thread || !['complete', 'failed'].includes(chat.status)) continue;
      const reply = chat.messages.find((message) => message.id === item.responseId);
      if (reply && !['complete', 'failed'].includes(reply.status)) continue;
      if (chat.status === 'failed' || !reply?.text) {
        await store
          .collection('helpdeskEmailMessages')
          .updateOne({ _id: item._id }, { $set: { status: 'needs-review' } });
        continue;
      }
      const current = await authorized(source);
      let canReply = true;
      try {
        await requireConnectorAction(store, current, 'respondToUsers');
      } catch (error) {
        if (error.status !== 403) throw error;
        canReply = false;
      }
      if (!current.email.autoReply || !canReply) {
        await store
          .collection('helpdeskEmailMessages')
          .updateOne({ _id: item._id }, { $set: { status: 'draft', draftText: reply.text } });
        continue;
      }
      // Claim before the external write. Ambiguous outcomes are never automatically resent.
      const claim = await store
        .collection('helpdeskEmailMessages')
        .updateOne(
          { _id: item._id, status: 'generating' },
          { $set: { status: 'sending', responseId: reply.id, attemptedAt: new Date() } },
        );
      if (!claim.modifiedCount) continue;
      try {
        await auditOperation(
          store,
          { id: 'zuno-email', ownerId: source.ownerId, workspaceId: source.workspaceId },
          'email-reply',
          `/email/${item._id}`,
          async () => {
            const latest = await authorized(source);
            if (!latest.email.autoReply) deny('Automatic replies are disabled.', 403);
            await requireConnectorAction(store, latest, 'respondToUsers');
            const headers = {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            };
            if (source.provider === 'gmail')
              await fetchChannelJson(
                fetcher,
                'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
                {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(gmailReply(item.message, source.mailbox, reply.text)),
                },
              );
            else
              await fetchChannelJson(
                fetcher,
                `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(item.message.id)}/reply`,
                { method: 'POST', headers, body: JSON.stringify({ comment: reply.text }) },
              );
            await store
              .collection('helpdeskEmailMessages')
              .updateOne(
                { _id: item._id, status: 'sending' },
                { $set: { status: 'sent', sentAt: new Date() } },
              );
            await store.collection('helpdeskRequests').updateOne(
              {
                _id: new ObjectId(thread.requestId),
                ownerId: source.ownerId,
                workspaceId: source.workspaceId,
                'messages.id': { $ne: reply.id },
              },
              {
                $push: {
                  messages: {
                    id: reply.id,
                    authorId: 'zuno',
                    authorName: 'Zuno',
                    kind: 'comment',
                    role: 'operator',
                    text: reply.text,
                    createdAt: new Date(),
                  },
                },
                $inc: { version: 1 },
                $set: { updatedAt: new Date() },
              },
            );
            return { status: 'complete' };
          },
        );
      } catch {
        await store
          .collection('helpdeskEmailMessages')
          .updateOne(
            { _id: item._id, status: 'sending' },
            { $set: { status: 'delivery-unknown' } },
          );
      }
    }
  }
  async function process(source) {
    const lease = randomUUID();
    const locked = await channels().findOneAndUpdate(
      {
        _id: source._id,
        'email.enabled': true,
        $or: [
          { 'email.leaseUntil': { $exists: false } },
          { 'email.leaseUntil': { $lt: new Date() } },
        ],
      },
      { $set: { 'email.lease': lease, 'email.leaseUntil': new Date(Date.now() + 900000) } },
      { returnDocument: 'after' },
    );
    if (!locked) return;
    try {
      await auditOperation(
        store,
        { id: 'zuno-email', ownerId: source.ownerId, workspaceId: source.workspaceId },
        'email-inbox-processing',
        `/channels/${source.provider}`,
        async () => {
          const current = await authorized(locked);
          const accessToken = await token(current);
          await deliver(current, accessToken);
          await poll(current, accessToken);
          await channels().updateOne(
            { _id: source._id, 'email.lease': lease },
            {
              $set: {
                'email.lastCheckedAt': new Date(),
                'email.error': null,
                'email.nextAt': new Date(Date.now() + 60000),
              },
            },
          );
          return { status: 'complete' };
        },
      );
    } catch {
      await channels().updateOne(
        { _id: source._id, 'email.lease': lease },
        {
          $set: {
            'email.error':
              'Inbox processing needs attention. Check authorization, provider availability, and inbox backlog.',
            'email.nextAt': new Date(Date.now() + 300000),
          },
        },
      );
    } finally {
      await channels().updateOne(
        { _id: source._id, 'email.lease': lease },
        { $unset: { 'email.lease': '', 'email.leaseUntil': '' } },
      );
    }
  }
  return { configure, process, ingest };
}
