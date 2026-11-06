import { ObjectId } from 'mongodb';
import { helpdeskScope, deny } from '../../identity/helpdeskRoles.js';
import { queryString, queryStrings } from '../../shared/queryValues.js';
import { databasePage, parseListQuery, listSearch } from '../../shared/databasePage.js';
import { visibleChatMessages } from '../../chat/chatPresentation.js';
import { auditOperation } from '../../audit/audit.js';
export function createChatReportsController(store) {
  function scope(user) {
    if (user.role !== 'admin') deny();
    const own = helpdeskScope(user);
    return {
      workspaceId: own.workspaceId,
      $or: [
        { providerOwnerId: own.ownerId },
        { providerOwnerId: { $exists: false }, ownerId: own.ownerId },
      ],
    };
  }
  const list = async (req, res) => {
    const filter = scope(req.helpdeskUser);
    if (req.query.days !== undefined && typeof req.query.days !== 'string')
      deny('Choose a valid reporting period.', 400);
    const days = typeof req.query.days === 'string' ? Number(req.query.days) : 30;
    if (![7, 30, 90].includes(days)) deny('Choose a valid reporting period.', 400);
    filter.createdAt = { $gte: new Date(Date.now() - days * 86400000) };
    const options = parseListQuery(
      req.query,
      { Chat: 'title', Status: 'status', Started: 'createdAt', Updated: 'updatedAt' },
      { sort: 'Updated', direction: 'desc' },
    );
    const result = await databasePage(
      store,
      [
        {
          name: 'chats',
          filter: { $and: [filter, listSearch(options.q, ['title', 'helpdeskPurpose', 'status'])] },
        },
      ],
      {
        ...options,
        projection: { messages: 0, source: 0, definition: 0, requestForm: 0, articleDraft: 0 },
      },
    );
    const ids = queryStrings([...new Set(result.rows.map((row) => row.ownerId))], 100, 80);
    const users = await store
      .collection('users')
      .find({ id: { $in: ids } }, { projection: { id: 1, name: 1, email: 1 } })
      .toArray();
    res.json({
      ...result,
      rows: result.rows.map((row) => ({
        id: String(row._id),
        title: row.title || 'Chat',
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        user: users.find((user) => user.id === row.ownerId)?.name || 'Workspace User',
        channel:
          row.helpdeskPurpose === 'slack-support'
            ? 'Slack'
            : row.helpdeskPurpose === 'teams-support'
              ? 'Teams'
              : row.helpdeskPurpose === 'email-support'
                ? 'Email'
                : 'Portal',
        assistant: row.assistantType === 'admin' ? 'Admin Agent' : 'Support Agent',
      })),
    });
  };
  const get = async (req, res) => {
    const filter = scope(req.helpdeskUser),
      id = req.params.id;
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) deny('Invalid chat.', 400);
    const chat = await store.collection('chats').findOne({ ...filter, _id: new ObjectId(id) });
    if (!chat) deny('Chat not found.', 404);
    const result = await auditOperation(
      store,
      req.helpdeskUser,
      'admin-chat-transcript-read',
      `/reports/chats/${id}`,
      async () => ({
        id: String(chat._id),
        title: chat.title || 'Chat',
        status: chat.status,
        messages: visibleChatMessages(chat).map((message) => ({
          id: message.id,
          role: message.role,
          text: typeof message.text === 'string' ? message.text : '',
          status: message.status,
          createdAt: message.createdAt,
          tools: (message.toolCalls || []).map((tool) => ({
            name: tool.name,
            status: tool.status,
          })),
        })),
      }),
      { resourceId: queryString(id, 24) },
    );
    res.json(result);
  };
  return { list, get };
}
