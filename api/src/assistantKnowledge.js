import { ObjectId } from 'mongodb';
import { createAuthoredSemantic } from './authoredSemantic.js';
import { canReadAuthoredArticle, knowledgeActor, knowledgeAllowed } from './knowledgeAccess.js';
import sanitizeHtml from 'sanitize-html';

const semanticServices = new WeakMap();

// Imported source content uses its separate delegated authorization path.
export async function retrieveAssistantKnowledge(store, chat, semanticOverride) {
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
  if (!query.trim()) return [];
  if (!semanticServices.has(store)) semanticServices.set(store, createAuthoredSemantic(store));
  const semantic = semanticOverride || semanticServices.get(store);
  let candidates = [];
  if (semantic.enabled) {
    try {
      const indexed = await store
        .collection('articles')
        .find(
          {
            ownerId: actor.helpdeskOwnerId || actor.id,
            status: 'Published',
            semanticStatus: 'Ready',
            $or: [{ workspaceId: actor.workspaceId }, { workspaceId: { $exists: false } }],
          },
          { projection: { base: 1, semanticGeneration: 1, semanticIndexedGeneration: 1 } },
        )
        .limit(2001)
        .toArray();
      if (indexed.length <= 2000) {
        const baseIds = [];
        for (const id of [...new Set(indexed.map((item) => item.base).filter(Boolean))])
          if (await knowledgeAllowed(store, actor, 'base', id)) baseIds.push(id);
        const generations = indexed
          .filter(
            (item) =>
              baseIds.includes(item.base) &&
              item.semanticGeneration === item.semanticIndexedGeneration,
          )
          .map((item) => item.semanticGeneration)
          .filter(Boolean);
        candidates = await semantic.candidates(actor, query, { baseIds, generations });
      }
    } catch {
      /* Authorized keyword retrieval remains available during local index outages. */
    }
  }
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = terms.map(escape).join('|');
  const records = terms.length
    ? await store
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
        .toArray()
    : [];
  const semanticRecords = candidates.length
    ? await store
        .collection('articles')
        .find({
          ownerId: chat.providerOwnerId || chat.ownerId,
          status: 'Published',
          semanticStatus: 'Ready',
          _id: { $in: candidates.map((item) => new ObjectId(item.id)) },
        })
        .limit(60)
        .toArray()
    : [];
  const semanticIds = new Set();
  for (const article of semanticRecords) {
    if (
      article.semanticGeneration === article.semanticIndexedGeneration &&
      candidates.some(
        (item) => item.id === String(article._id) && item.generation === article.semanticGeneration,
      )
    ) {
      semanticIds.add(String(article._id));
      if (!records.some((item) => String(item._id) === String(article._id))) records.push(article);
    }
  }
  const permitted = [];
  for (const article of records)
    if (await canReadAuthoredArticle(store, actor, article)) permitted.push(article);
  return permitted
    .map((article) => {
      const text = sanitizeHtml(article.body || '', { allowedTags: [], allowedAttributes: {} });
      const searchable = `${article.title} ${text}`.toLowerCase();
      const keywordScore = terms.reduce(
        (total, term) => total + (searchable.includes(term) ? 1 : 0),
        0,
      );
      const semanticScore = semanticIds.has(String(article._id))
        ? Math.max(
            ...candidates
              .filter((item) => item.id === String(article._id))
              .map((item) => item.score),
          )
        : 0;
      const score = keywordScore + semanticScore * 3;
      return {
        id: article._id,
        title: article.title,
        text: text.slice(0, 3500),
        body: article.body,
        updatedAt: article.updatedAt,
        score,
        retrievalMethod: semanticScore ? (keywordScore ? 'hybrid' : 'semantic') : 'keyword',
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
