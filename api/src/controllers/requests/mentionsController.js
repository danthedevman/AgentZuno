import { canWorkRequest as canReadNotes } from '../../requests/requestPolicy.js';
import { recordMentionRecords } from '../../records/recordMentions.js';
import { queryString } from '../../shared/queryValues.js';
import { taskInboxRecords } from '../../requests/requestTasks.js';

import { helpdeskScope, deny } from '../../identity/helpdeskRoles.js';

import { recipient, visibleInboxRecords } from '../../requests/mentions.js';
export function createMentionsController(store, service) {
  const getRequestsIdMentionOptions = async (request, response) => {
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
  };
  const getInboxUnread = async (request, response) => {
    const user = request.helpdeskUser;
    const state = await store
      .collection('inboxReadState')
      .findOne({ userId: queryString(user.id), workspaceId: queryString(user.workspaceId) });
    const rows = await visibleInboxRecords(store, service, user);
    const archived = await store
      .collection('helpdeskInbox')
      .find({
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
        archived: true,
      })
      .toArray();
    const primary = rows.filter(
      (row) => !archived.some((item) => String(item.requestId) === String(row._id)),
    );
    const tasks = (await taskInboxRecords(store, user)).filter(
      (task) => !archived.some((item) => String(item.taskId) === task.id),
    );
    const recordMentions = (await recordMentionRecords(store, user)).filter(
      (entry) =>
        !archived.some(
          (item) => item.kind === 'record-mention' && String(item.requestId) === String(entry._id),
        ),
    );
    response.json({
      unread:
        recordMentions.some(
          (entry) => !state || new Date(entry.createdAt) > new Date(state.viewedAt),
        ) ||
        tasks.some((task) => !state || new Date(task.updatedAt) > new Date(state.viewedAt)) ||
        primary.some((row) => !state || new Date(row.updatedAt) > new Date(state.viewedAt)),
      hasMentions:
        recordMentions.length > 0 ||
        rows.some((row) =>
          row.notifications?.some(
            (item) =>
              item.recipientId === user.id &&
              (item.kind !== 'work-note' || canReadNotes(user, row)),
          ),
        ),
    });
  };
  const postInboxViewed = async (request, response) => {
    const user = request.helpdeskUser;
    const filter = {
      _id: `${user.workspaceId}:${user.id}`,
      userId: queryString(user.id),
      workspaceId: queryString(user.workspaceId),
    };
    await store
      .collection('inboxReadState')
      .updateOne(
        filter,
        { $max: { viewedAt: new Date() }, $setOnInsert: filter },
        { upsert: true },
      );
    response.json({ viewed: true });
  };
  return { getRequestsIdMentionOptions, getInboxUnread, postInboxViewed };
}
