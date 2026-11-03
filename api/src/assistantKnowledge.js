import { canReadAuthoredArticle, knowledgeActor } from './knowledgeAccess.js';
import sanitizeHtml from 'sanitize-html';

// Imported source content uses its separate delegated authorization path.
export async function retrieveAssistantKnowledge(store, chat) {
  if (
    chat.helpdeskPurpose === 'email-support' ||
    (chat.helpdeskPurpose === 'slack-support' && !chat.channelUserId)
  )
    return [];
  if (
    chat.helpdeskPurpose === 'slack-support' &&
    !(await store.collection('users').findOne({ id: chat.ownerId, workspaceId: chat.workspaceId }))
  )
    return [];
  let actor;
  try {
    actor = await knowledgeActor(store, chat);
  } catch {
    return [];
  }
  const query = chat.messages.filter((message) => message.role === 'user').at(-1)?.text || '';
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])]
    .filter(
      (term) =>
        !['how', 'can', 'the', 'and', 'for', 'you', 'with', 'request', 'please'].includes(term),
    )
    .slice(0, 20);
  if (!terms.length) return [];
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = terms.map(escape).join('|');
  const records = await store
    .collection('articles')
    .find({
      ownerId: chat.providerOwnerId || chat.ownerId,
      status: 'Published',
      $or: [
        { title: { $regex: pattern, $options: 'i' } },
        { body: { $regex: pattern, $options: 'i' } },
      ],
    })
    .sort({ updatedAt: -1 })
    .limit(40)
    .toArray();
  const permitted = [];
  for (const article of records)
    if (await canReadAuthoredArticle(store, actor, article)) permitted.push(article);
  return permitted
    .map((article) => {
      const text = sanitizeHtml(article.body || '', { allowedTags: [], allowedAttributes: {} });
      const searchable = `${article.title} ${text}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (searchable.includes(term) ? 1 : 0), 0);
      return {
        id: article._id,
        title: article.title,
        text: text.slice(0, 3500),
        body: article.body,
        updatedAt: article.updatedAt,
        score,
      };
    })
    .filter((article) => article.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export async function verifyAssistantKnowledge(store, chat, references) {
  if (!references.length) return;
  const actor = await knowledgeActor(store, chat);
  for (const article of references) {
    const current = await store.collection('articles').findOne({
      _id: article.id,
      ownerId: chat.providerOwnerId || chat.ownerId,
      status: 'Published',
    });
    if (
      !current ||
      !(await canReadAuthoredArticle(store, actor, current)) ||
      current.body !== article.body ||
      current.title !== article.title ||
      String(current.updatedAt) !== String(article.updatedAt)
    ) {
      throw Object.assign(new Error('Knowledge changed. Retry to use the latest article.'), {
        publicMessage: 'Knowledge changed. Retry to use the latest article.',
      });
    }
  }
}
