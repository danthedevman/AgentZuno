import { ObjectId } from 'mongodb';
import { deny } from '../identity/helpdeskRoles.js';
import { authorizeRecord } from './recordAccess.js';
import { prepareRecordMentions } from './recordMentions.js';
import { databasePage, parseListQuery } from '../shared/databasePage.js';
import { listResponse } from '../shared/listQuery.js';

export function createRecordActivity(store) {
  async function list(user, kind, id, query) {
    const permissions = await authorizeRecord(store, user, kind, id, query.tableId);
    const { canComment, canNote, canReadNotes, scope } = permissions;
    const type = query.type || 'comments';
    if (!['comments', 'notes'].includes(type)) deny('Invalid activity type.', 400);
    if (type === 'notes' && !canReadNotes) deny();
    const options = parseListQuery(
      query,
      { Created: { field: 'createdAt', type: 'date' } },
      { sort: 'Created', direction: 'desc' },
    );
    const filter = { ...scope, type: type === 'notes' ? 'note' : 'comment' };
    let result;
    if (
      store.collection('recordActivity').aggregate ||
      store.collection('recordActivity').nativePage
    )
      result = await databasePage(store, [{ name: 'recordActivity', filter }], options);
    else
      result = listResponse(
        { query: { ...query, list: '1' } },
        await store.collection('recordActivity').find(filter).sort({ createdAt: -1 }).toArray(),
        { Created: (item) => item.createdAt },
        { sort: 'Created', direction: 'desc' },
      );
    return {
      ...result,
      permissions: { canComment, canNote, canReadNotes },
      rows: result.rows.map(({ _id, ownerId, workspaceId, notifications, ...record }) => ({
        id: String(_id),
        ...record,
      })),
    };
  }
  async function add(user, kind, id, input) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['type', 'text', 'tableId', 'mentionIds'].includes(key)) ||
      !['comment', 'note'].includes(input.type) ||
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 7000
    )
      deny('Enter a comment or note of 1–7,000 characters.', 400);
    const { canComment, canNote, scope, title, href } = await authorizeRecord(
      store,
      user,
      kind,
      id,
      input.tableId,
    );
    if (!(input.type === 'note' ? canNote : canComment)) deny();
    const account = await store
      .collection('users')
      .findOne({ id: user.id }, { projection: { name: 1 } });
    const record = {
      _id: new ObjectId(),
      ...scope,
      recordKind: kind,
      title,
      href,
      updatedAt: new Date(),
      type: input.type,
      text: input.text.trim(),
      authorId: user.id,
      authorName: account?.name || user.name || 'Team Member',
      createdAt: new Date(),
    };
    const prepared = await prepareRecordMentions(store, user, record, input.mentionIds);
    record.mentions = prepared.mentions;
    record.notifications = prepared.notifications;
    const saved = await store.collection('recordActivity').insertOne(record);
    return { id: String(saved.insertedId) };
  }
  return { list, add };
}
