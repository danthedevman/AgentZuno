import { canWorkRequest as canReadNotes } from './requestPolicy.js';
import { createRecordMentionDelivery } from '../records/recordMentions.js';
import { queryString, queryStrings } from '../shared/queryValues.js';

import { randomUUID } from 'node:crypto';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { smtpConfiguration, smtpTransport } from '../channels/smtpSettings.js';
import { isEmailAddress } from '../shared/emailAddress.js';

export async function recipient(store, service, record, id, kind) {
  const member = await store.collection('helpdeskMembers').findOne({
    ownerId: queryString(record.ownerId),
    workspaceId: queryString(record.workspaceId),
    userId: id,
    active: true,
  });
  if (!member) return null;
  const user = {
    id,
    workspaceId: queryString(record.workspaceId),
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
        emailStatus: 'pending',
      });
  }
  return { mentions, notifications };
}
export function requestMentionNotice(user, record) {
  const notice = record.notifications?.findLast(
    (item) =>
      item.recipientId === user.id && (item.kind !== 'work-note' || canReadNotes(user, record)),
  );
  return notice
    ? notice.kind === 'work-note'
      ? 'Mentioned You in a Work Note'
      : 'Mentioned You in a Comment'
    : undefined;
}
export function inboxMatches(user) {
  return [
    {
      queueName: {
        $in: ['admin', 'agent', 'read-only'].includes(user.role)
          ? queryStrings(user.queues || [], 30, 80)
          : [],
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
      ? [
          {
            queueName: { $in: queryStrings(user.queues || [], 30, 80) },
            'notifications.recipientId': user.id,
          },
        ]
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

export function createMentionDelivery(store, service, send) {
  const deliverRecords = createRecordMentionDelivery(store, send);
  return async () => {
    await deliverRecords();
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
