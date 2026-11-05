import { taskInboxRecords } from './requestTasks.js';
import { randomUUID } from 'node:crypto';
import { helpdeskScope, deny } from './helpdeskRoles.js';
import { smtpConfiguration, smtpTransport } from './smtpSettings.js';
import { isEmailAddress } from './emailAddress.js';

const canReadNotes = (user, record) =>
  user.role === 'admin' || (user.role === 'agent' && user.queues.includes(record.queueName));
async function recipient(store, service, record, id, kind) {
  const member = await store.collection('helpdeskMembers').findOne({
    ownerId: record.ownerId,
    workspaceId: record.workspaceId,
    userId: id,
    active: true,
  });
  if (!member) return null;
  const user = {
    id,
    workspaceId: record.workspaceId,
    helpdeskOwnerId: record.ownerId,
    role: member.role,
    queues: member.queues || [],
    canApprove: member.canApprove === true,
  };
  if (
    !(await service.canRead(user, record)) ||
    (kind === 'work-note' && !canReadNotes(user, record))
  )
    return null;
  const account = await store.collection('users').findOne({ id });
  return account
    ? {
        ...user,
        name: account.name || member.email,
        email: account.displayEmail || account.email || member.email,
      }
    : null;
}
export async function prepareMentions(store, service, actor, record, entry, ids = [], kind) {
  if (
    !Array.isArray(ids) ||
    ids.length > 10 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id))
  )
    deny('Mention up to 10 available people.', 400);
  const mentions = [],
    notifications = [];
  for (const id of ids) {
    const person = await recipient(store, service, record, id, kind);
    if (!person || !entry.text.includes('@' + person.name))
      deny(
        'Choose a person who can read this request and include their mention in the message.',
        400,
      );
    mentions.push({ userId: id, name: person.name });
    if (id !== actor.id)
      notifications.push({
        id: randomUUID(),
        recipientId: id,
        actorId: actor.id,
        actorName: actor.name || 'A teammate',
        entryId: entry.id,
        kind,
        createdAt: entry.createdAt,
        emailStatus: actor.isInteractiveDemo ? 'disabled' : 'pending',
      });
  }
  return { mentions, notifications };
}
export function inboxMatches(user) {
  return [
    {
      queueName: {
        $in: ['admin', 'agent', 'read-only'].includes(user.role) ? user.queues || [] : [],
      },
    },
    ...(user.canApprove ? [{ approvalUserIds: user.id }] : []),
    {
      notifications: {
        $elemMatch: {
          recipientId: user.id,
          ...(canReadNotes(user, { queueName: '' }) ? {} : { kind: 'comment' }),
        },
      },
    },
    ...(user.role === 'agent'
      ? [{ queueName: { $in: user.queues || [] }, 'notifications.recipientId': user.id }]
      : []),
  ];
}
export async function visibleInboxRecords(store, service, user) {
  const rows = await store
    .collection('helpdeskRequests')
    .find({ ...helpdeskScope(user), $or: inboxMatches(user) })
    .toArray();
  const visible = [];
  for (const row of rows)
    if ((await service.isSubmitted(row)) && (await service.canRead(user, row))) visible.push(row);
  return visible;
}
export function installMentionRoutes(app, store, service) {
  app.get('/api/helpdesk/requests/:id/mention-options', async (request, response) => {
    const actor = request.helpdeskUser,
      record = await service.get(actor, request.params.id);
    const kind = request.query.kind || 'comment',
      q = request.query.q || '';
    if (!['comment', 'work-note'].includes(kind) || typeof q !== 'string' || q.length > 100)
      deny('Invalid mention search.', 400);
    if (kind === 'work-note' && !canReadNotes(actor, record)) deny();
    const members = await store
      .collection('helpdeskMembers')
      .find({ ...helpdeskScope(actor), active: true })
      .limit(2000)
      .toArray();
    const accounts = await store
      .collection('users')
      .find(
        { id: { $in: members.map((member) => member.userId) } },
        { projection: { id: 1, name: 1 } },
      )
      .sort({ name: 1 })
      .toArray();
    const options = [];
    for (const account of accounts) {
      if (!account.name?.toLowerCase().includes(q.toLowerCase())) continue;
      const person = await recipient(store, service, record, account.id, kind);
      if (person && person.name.toLowerCase().includes(q.toLowerCase()))
        options.push({ value: person.id, label: person.name });
      if (options.length === 10) break;
    }
    response.json(options);
  });
  app.get('/api/helpdesk/inbox/unread', async (request, response) => {
    const user = request.helpdeskUser;
    const state = await store
      .collection('inboxReadState')
      .findOne({ userId: user.id, workspaceId: user.workspaceId });
    const rows = await visibleInboxRecords(store, service, user);
    const archived = await store
      .collection('helpdeskInbox')
      .find({ ownerId: user.id, workspaceId: user.workspaceId, archived: true })
      .toArray();
    const primary = rows.filter(
      (row) => !archived.some((item) => String(item.requestId) === String(row._id)),
    );
    const tasks = (await taskInboxRecords(store, user)).filter(
      (task) => !archived.some((item) => String(item.taskId) === task.id),
    );
    response.json({
      unread:
        tasks.some((task) => !state || new Date(task.updatedAt) > new Date(state.viewedAt)) ||
        primary.some((row) => !state || new Date(row.updatedAt) > new Date(state.viewedAt)),
      hasMentions: rows.some((row) =>
        row.notifications?.some(
          (item) =>
            item.recipientId === user.id && (item.kind !== 'work-note' || canReadNotes(user, row)),
        ),
      ),
    });
  });
  app.post('/api/helpdesk/inbox/viewed', async (request, response) => {
    const user = request.helpdeskUser;
    const filter = {
      _id: `${user.workspaceId}:${user.id}`,
      userId: user.id,
      workspaceId: user.workspaceId,
    };
    await store
      .collection('inboxReadState')
      .updateOne(
        filter,
        { $max: { viewedAt: new Date() }, $setOnInsert: filter },
        { upsert: true },
      );
    response.json({ viewed: true });
  });
}
export function createMentionDelivery(store, service, send) {
  return async () => {
    const rows = await store
      .collection('helpdeskRequests')
      .find({ 'notifications.emailStatus': 'pending' })
      .limit(20)
      .toArray();
    for (const row of rows)
      for (const item of row.notifications || []) {
        if (item.emailStatus !== 'pending') continue;
        const current = await store
          .collection('helpdeskRequests')
          .findOne({ _id: row._id, ownerId: row.ownerId, workspaceId: row.workspaceId });
        if (!current) continue;
        const person = await recipient(store, service, current, item.recipientId, item.kind);
        const config = await smtpConfiguration(store, {
          ownerId: row.ownerId,
          workspaceId: row.workspaceId,
        });
        const status = !person
          ? 'denied'
          : !isEmailAddress(person.email) || (!config && !send)
            ? 'disabled'
            : 'sending';
        const filter = {
          _id: row._id,
          notifications: { $elemMatch: { id: item.id, emailStatus: 'pending' } },
        };
        const options = { arrayFilters: [{ 'notification.id': item.id }] };
        const claimed = await store
          .collection('helpdeskRequests')
          .updateOne(
            filter,
            { $set: { 'notifications.$[notification].emailStatus': status } },
            options,
          );
        if (!claimed.modifiedCount || status !== 'sending') continue;
        let transport;
        try {
          const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
          const link = `${origin}/workspace/${row.workspaceId}/chat/${row.chatId}?request=${row._id}`;
          const message = {
            from: config?.from,
            to: person.email,
            subject: `You were mentioned in ${row.number}`,
            text: `${item.actorName} mentioned you in a ${item.kind === 'work-note' ? 'work note' : 'comment'} on ${row.number}.\n\nOpen the request: ${link}`,
          };
          if (send) await send(message);
          else {
            transport = await smtpTransport(config);
            await transport.sendMail(message);
          }
          await store
            .collection('helpdeskRequests')
            .updateOne(
              { _id: row._id },
              { $set: { 'notifications.$[notification].emailStatus': 'sent' } },
              options,
            );
        } catch {
          // SMTP may have accepted the message; do not automatically resend uncertain delivery.
          await store
            .collection('helpdeskRequests')
            .updateOne(
              { _id: row._id },
              { $set: { 'notifications.$[notification].emailStatus': 'delivery-unknown' } },
              options,
            );
        } finally {
          transport?.close();
        }
      }
  };
}
