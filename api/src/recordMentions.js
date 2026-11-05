import { randomUUID } from 'node:crypto';
import { authorizeRecord } from './recordAccess.js';
import { helpdeskScope, deny } from './helpdeskRoles.js';
import { queryString } from './queryValues.js';
import { smtpConfiguration, smtpTransport } from './smtpSettings.js';
import { isEmailAddress } from './emailAddress.js';

async function recipient(store, entry, id) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return null;
  const member = await store.collection('helpdeskMembers').findOne({
    ownerId: queryString(entry.ownerId, 24),
    workspaceId: queryString(entry.workspaceId, 24),
    userId: queryString(id, 24),
    active: true,
  });
  if (!member) return null;
  const user = {
    id,
    workspaceId: entry.workspaceId,
    helpdeskOwnerId: entry.ownerId,
    role: member.role,
    queues: member.queues || [],
    canApprove: member.canApprove === true,
    readOnlyRequest: member.role === 'read-only',
  };
  try {
    const access = await authorizeRecord(store, user, entry.kind, entry.recordId, entry.tableId);
    if (entry.type === 'note' && !access.canReadNotes) return null;
    const account = await store.collection('users').findOne({ id: queryString(id, 24) });
    return account
      ? {
          ...user,
          name: account.name || member.email,
          email: account.displayEmail || account.email || member.email,
        }
      : null;
  } catch (error) {
    if ([400, 403, 404].includes(error.status)) return null;
    throw error;
  }
}
export async function recordMentionOptions(store, actor, kind, id, query) {
  const access = await authorizeRecord(store, actor, kind, id, query.tableId);
  const type = query.kind || 'comment',
    q = query.q || '';
  if (!['comment', 'work-note'].includes(type) || typeof q !== 'string' || q.length > 100)
    deny('Invalid mention search.', 400);
  if (!(type === 'work-note' ? access.canNote : access.canComment)) deny();
  const members = await store
    .collection('helpdeskMembers')
    .find({ ...helpdeskScope(actor), active: true })
    .limit(2000)
    .toArray();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const accounts = await store
    .collection('users')
    .find(
      {
        id: { $in: members.map((item) => queryString(item.userId)) },
        name: { $regex: escaped, $options: 'i' },
      },
      { projection: { id: 1, name: 1 } },
    )
    .sort({ name: 1 })
    .limit(200)
    .toArray();
  const options = [];
  for (const account of accounts) {
    const person = await recipient(
      store,
      { ...access.scope, type: type === 'work-note' ? 'note' : 'comment' },
      account.id,
    );
    if (person) options.push({ value: person.id, label: person.name });
    if (options.length === 10) break;
  }
  return options;
}
export async function prepareRecordMentions(store, actor, entry, ids = []) {
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
    const person = await recipient(store, entry, id);
    if (!person || !entry.text.includes('@' + person.name))
      deny(
        'Choose a person with access to this record and include their mention in the message.',
        400,
      );
    mentions.push({ userId: id, name: person.name });
    if (id !== actor.id)
      notifications.push({
        id: randomUUID(),
        recipientId: id,
        actorId: actor.id,
        actorName: entry.authorName,
        entryId: String(entry._id),
        kind: entry.type === 'note' ? 'work-note' : 'comment',
        createdAt: entry.createdAt,
        emailStatus: 'pending',
      });
  }
  return { mentions, notifications };
}
export function recordMentionDto(entry) {
  return {
    id: String(entry._id),
    kind: 'record-mention',
    title: entry.title,
    description: `${entry.authorName} added a ${entry.type === 'note' ? 'work note' : 'comment'} and mentioned you`,
    number: entry.recordKind === 'task' ? 'Task' : 'Record',
    status: 'new',
    inboxNotice:
      entry.type === 'note' ? 'Mentioned You in a Work Note' : 'Mentioned You in a Comment',
    updatedAt: entry.createdAt,
    href: `${entry.href}?activity=${entry.type === 'note' ? 'notes' : 'comments'}`,
  };
}
export async function recordMentionRecords(store, user) {
  const entries = await store
    .collection('recordActivity')
    .find(
      { ...helpdeskScope(user), 'notifications.recipientId': queryString(user.id) },
      { projection: { text: 0, notifications: 0 } },
    )
    .toArray();
  const visible = [];
  for (const entry of entries) {
    try {
      const access = await authorizeRecord(store, user, entry.kind, entry.recordId, entry.tableId);
      if (entry.type !== 'note' || access.canReadNotes) visible.push(entry);
    } catch (error) {
      if (![400, 403, 404].includes(error.status)) throw error;
    }
  }
  return visible;
}
export function createRecordMentionDelivery(store, send) {
  return async () => {
    const entries = await store
      .collection('recordActivity')
      .find({ 'notifications.emailStatus': 'pending' })
      .limit(20)
      .toArray();
    for (const entry of entries)
      for (const item of entry.notifications || []) {
        if (item.emailStatus !== 'pending') continue;
        const person = await recipient(store, entry, item.recipientId);
        const config = await smtpConfiguration(store, {
          ownerId: entry.ownerId,
          workspaceId: entry.workspaceId,
        });
        const status = !person
          ? 'denied'
          : !isEmailAddress(person.email) || (!config && !send)
            ? 'disabled'
            : 'sending';
        const options = { arrayFilters: [{ 'notification.id': item.id }] };
        const claimed = await store.collection('recordActivity').updateOne(
          {
            _id: entry._id,
            notifications: { $elemMatch: { id: item.id, emailStatus: 'pending' } },
          },
          { $set: { 'notifications.$[notification].emailStatus': status } },
          options,
        );
        if (!claimed.modifiedCount || status !== 'sending') continue;
        let transport;
        try {
          const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
          const link = `${origin}/workspace/${entry.workspaceId}${recordMentionDto(entry).href.slice('/workspace'.length)}`;
          const message = {
            from: config?.from,
            to: person.email,
            subject: `You were mentioned on ${entry.title}`,
            text: `${item.actorName} mentioned you in a ${item.kind === 'work-note' ? 'work note' : 'comment'}.\n\nOpen the record: ${link}`,
          };
          if (send) await send(message);
          else {
            transport = await smtpTransport(config);
            await transport.sendMail(message);
          }
          await store
            .collection('recordActivity')
            .updateOne(
              { _id: entry._id },
              { $set: { 'notifications.$[notification].emailStatus': 'sent' } },
              options,
            );
        } catch {
          // An uncertain SMTP result must not trigger automatic duplicate emails.
          await store
            .collection('recordActivity')
            .updateOne(
              { _id: entry._id },
              { $set: { 'notifications.$[notification].emailStatus': 'delivery-unknown' } },
              options,
            );
        } finally {
          transport?.close();
        }
      }
  };
}
