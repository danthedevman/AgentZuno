import { ObjectId } from 'mongodb';
import { helpdeskScope, requireRole } from '../identity/helpdeskRoles.js';
import { queryString } from '../shared/queryValues.js';
import { articleCandidate } from '../knowledge/articleDesigner.js';
export async function ensureWorkflowAuthoringDraft(store, user, chat) {
  requireRole(user, ['admin']);
  const id = new ObjectId(queryString(chat.id, 24)),
    now = new Date();
  await store.collection('helpdeskWorkflows').updateOne(
    { ...helpdeskScope(user), _id: id },
    {
      $setOnInsert: {
        name: 'Untitled Workflow',
        enabled: false,
        isAuthoringDraft: true,
        version: 1,
        department: 'general',
        keywords: [],
        action: 'route',
        queueName: '',
        source: '',
        definition: null,
        createdAt: now,
        updatedAt: now,
        createdBy: user.id,
      },
    },
    { upsert: true },
  );
  return String(id);
}
export async function ensureArticleAuthoringDraft(store, user, chat, draft) {
  requireRole(user, ['admin']);
  const id = new ObjectId(queryString(chat.id, 24)),
    now = new Date().toISOString(),
    clean = articleCandidate(draft);
  await store.collection('articles').updateOne(
    { ownerId: queryString(user.id), workspaceId: queryString(user.workspaceId), _id: id },
    {
      $setOnInsert: {
        title: clean.title || 'Untitled Article',
        body: clean.body || '<p></p>',
        summary: '',
        status: 'Draft',
        base: user.workspaceId,
        topicIds: [],
        attachmentIds: [],
        sections: [],
        label: 'Your article',
        isAuthoringDraft: true,
        authoringChatId: chat.id,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  return {
    id: String(id),
    updatedAt: (
      await store.collection('articles').findOne({
        _id: id,
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
      })
    ).updatedAt,
  };
}
