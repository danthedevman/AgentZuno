import { ensureArticleAuthoringDraft } from '../../workflows/authoringDrafts.js';
import { queryString } from '../../shared/queryValues.js';
import { listResponse } from '../../shared/listQuery.js';
import { ObjectId } from 'mongodb';

import { requireRole } from '../../identity/helpdeskRoles.js';
import { fail, validateArticleDraft, articleCandidate } from '../../knowledge/articleDesigner.js';
export function createArticleDesignerController(store, content, chats, saveArticle) {
  const scope = (user) => ({ ownerId: user.id, workspaceId: user.workspaceId });
  async function actor(request) {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    if (user.isDemo) fail('Sign in to edit articles.', 401);
    return user;
  }
  async function conversation(user, id) {
    if (!ObjectId.isValid(id)) fail('Article conversation not found.', 404);
    const chat = await chats.get(user, id);
    if (
      chat.helpdeskPurpose !== 'article' ||
      chat.providerOwnerId !== (user.helpdeskOwnerId || user.id)
    )
      fail('Article conversation not found.', 404);
    return chat;
  }
  async function proposal(user, id) {
    if (!ObjectId.isValid(id)) fail('Article preview not found.', 404);
    const record = await store
      .collection('articleProposals')
      .findOne({ ...scope(user), _id: new ObjectId(id) });
    if (!record) fail('Article preview not found.', 404);
    return record;
  }
  const getArticleConversations = async (request, response) => {
    const user = await actor(request);
    const articleId = request.query.articleId;
    if (
      typeof articleId !== 'string' ||
      !ObjectId.isValid(articleId) ||
      !(await content.article(user.id, articleId))
    )
      fail('Article not found.', 404);
    const records = await store
      .collection('chats')
      .find(
        {
          ...scope(user),
          providerOwnerId: user.helpdeskOwnerId || user.id,
          helpdeskPurpose: 'article',
          articleId,
        },
        { projection: { title: 1, status: 1, updatedAt: 1 } },
      )
      .sort({ updatedAt: -1 })
      .toArray();
    response.json(
      listResponse(
        request,
        records.map((record) => ({
          id: record._id.toHexString(),
          title: record.title || 'Article conversation',
          status: record.status,
          updatedAt: record.updatedAt,
        })),
        { Conversation: 'title', Status: 'status', Updated: 'updatedAt' },
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  };
  const postArticleConversations = async (request, response) => {
    const user = await actor(request);
    const draft = validateArticleDraft(request.body?.draft);
    if (request.body.articleId && !(await content.article(user.id, request.body.articleId)))
      fail('Article not found.', 404);
    const chat = await chats.create(
      user,
      { requestId: request.body.requestId, text: request.body.text },
      {
        providerOwnerId: user.helpdeskOwnerId || user.id,
        assistantType: 'admin',
        helpdeskPurpose: 'article',
        articleDraft: draft,
        articleId: request.body.articleId || null,
      },
    );
    let articleId = request.body.articleId || null,
      updatedAt = null;
    if (!articleId) {
      const saved = await ensureArticleAuthoringDraft(store, user, chat, draft);
      articleId = saved.id;
      updatedAt = saved.updatedAt;
      await store
        .collection('chats')
        .updateOne(
          { ...scope(user), _id: new ObjectId(chat.id), helpdeskPurpose: 'article' },
          { $set: { articleId: queryString(articleId, 24) } },
        );
    }
    response.status(202).json({ ...chat, articleId, articleUpdatedAt: updatedAt });
  };
  const getArticleConversationsId = async (request, response) => {
    const user = await actor(request);
    const chat = await conversation(user, request.params.id);
    response.json({
      id: request.params.id,
      status: chat.status,
      messages: chat.messages,
      candidate:
        chat.status === 'complete' && chat.responseId !== chat.lastApprovedResponseId
          ? articleCandidate(
              chat.messages.filter((message) => message.role === 'assistant').at(-1)?.proposals
                ?.article,
            )
          : null,
    });
  };
  const postArticleConversationsIdMessages = async (request, response) => {
    const user = await actor(request);
    await conversation(user, request.params.id);
    const draft = validateArticleDraft(request.body?.draft);
    response
      .status(202)
      .json(
        await chats.send(
          user,
          request.params.id,
          { text: request.body.text },
          { articleDraft: draft },
        ),
      );
  };
  const postArticleProposals = async (request, response) => {
    const user = await actor(request);
    const articleId = request.body?.articleId || null;
    const chatId = request.body?.chatId || null;
    let chatResponseId = null;
    if (chatId) {
      const source = await conversation(user, chatId);
      chatResponseId =
        source.messages?.filter((message) => message.role === 'assistant').at(-1)?.id || null;
      if ((source.articleId || null) !== articleId)
        fail('This conversation belongs to a different article.', 409);
    }
    const current = articleId ? await content.article(user.id, articleId) : null;
    if (articleId && !current) fail('Article not found.', 404);
    if (current && request.body.expectedUpdatedAt !== current.updatedAt)
      fail('The article changed. Reload before reviewing your changes.', 409);
    let preview;
    const dryResponse = {
      status(code) {
        this.code = code;
        return this;
      },
      json(value) {
        preview = { code: this.code || 200, value };
        return this;
      },
    };
    await saveArticle(
      { ...request, params: { id: articleId }, body: request.body.draft, articlePreviewOnly: true },
      dryResponse,
    );
    if (preview.code >= 400) return response.status(preview.code).json(preview.value);
    const record = {
      ...scope(user),
      articleId,
      chatId,
      chatResponseId,
      expectedUpdatedAt: current?.updatedAt || null,
      draft: preview.value,
      status: 'pending',
      createdAt: new Date(),
    };
    record._id = (await store.collection('articleProposals').insertOne(record)).insertedId;
    response
      .status(201)
      .json({ id: record._id.toHexString(), draft: record.draft, status: record.status });
  };
  const getArticleProposalsId = async (request, response) => {
    const user = await actor(request);
    const record = await proposal(user, request.params.id);
    response.json({ id: request.params.id, draft: record.draft, status: record.status });
  };
  const postArticleProposalsIdApprove = async (request, response) => {
    const user = await actor(request);
    if (
      request.body?.approved !== true ||
      Object.keys(request.body).some((key) => key !== 'approved')
    )
      fail('Explicit approval is required.');
    const record = await proposal(user, request.params.id);
    if (record.status === 'approved') return response.json(record.result);
    const locked = await store
      .collection('articleProposals')
      .updateOne(
        { ...scope(user), _id: record._id, status: 'pending' },
        { $set: { status: 'applying' } },
      );
    if (!locked.matchedCount)
      fail('This approval is already being processed. Check the article before retrying.', 409);
    const current = record.articleId ? await content.article(user.id, record.articleId) : null;
    if (record.articleId && (!current || current.updatedAt !== record.expectedUpdatedAt)) {
      await store
        .collection('articleProposals')
        .updateOne({ _id: record._id }, { $set: { status: 'stale' } });
      fail('The article changed after this preview. Review a fresh proposal.', 409);
    }
    let saved;
    const resultResponse = {
      status(code) {
        this.code = code;
        return this;
      },
      json(value) {
        saved = { code: this.code || 200, value };
        return this;
      },
    };
    await saveArticle(
      {
        ...request,
        params: { id: record.articleId },
        body: record.draft,
        articleExpectedUpdatedAt: record.expectedUpdatedAt,
        articleProposalId: request.params.id,
      },
      resultResponse,
    );
    if (saved.code >= 400) {
      await store
        .collection('articleProposals')
        .updateOne({ _id: record._id }, { $set: { status: 'pending' } });
      return response.status(saved.code).json(saved.value);
    }
    await store
      .collection('articleProposals')
      .updateOne(
        { _id: record._id, ...scope(user) },
        { $set: { status: 'approved', approvedAt: new Date(), result: saved.value } },
      );
    if (record.chatId)
      await store.collection('chats').updateOne(
        {
          ...scope(user),
          _id: new ObjectId(record.chatId),
          helpdeskPurpose: 'article',
          articleId: record.articleId || null,
        },
        { $set: { articleId: saved.value.id, lastApprovedResponseId: record.chatResponseId } },
      );
    response.json(saved.value);
  };
  return {
    getArticleConversations,
    postArticleConversations,
    getArticleConversationsId,
    postArticleConversationsIdMessages,
    postArticleProposals,
    getArticleProposalsId,
    postArticleProposalsIdApprove,
  };
}
