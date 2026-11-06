import { articleListMetadata } from '../../knowledge/articleListMetadata.js';
import { knowledgeDirectory } from '../../knowledge/knowledgeExplorer.js';
import { ObjectId } from 'mongodb';
import { deny, helpdeskScope, requireRole } from '../../identity/helpdeskRoles.js';
import { listResponse } from '../../shared/listQuery.js';
import { canReadAuthoredArticle, kinds } from '../../knowledge/knowledgeAccess.js';
export function createKnowledgeAccessController(store) {
  async function target(user, kind, id) {
    if (!kinds.includes(kind) || !ObjectId.isValid(id)) deny('Knowledge item not found.', 404);
    if (kind === 'base' && id === user.workspaceId) return;
    const record = await store.collection(kind === 'article' ? 'articles' : 'records').findOne({
      _id: new ObjectId(id),
      ownerId: user.helpdeskOwnerId || user.id,
      ...(kind === 'article' ? {} : { type: kind === 'base' ? 'knowledge-base' : 'topic' }),
    });
    if (!record) deny('Knowledge item not found.', 404);
  }
  const getKnowledgePermissionsKindId = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    await target(user, request.params.kind, request.params.id);
    const policy = await store.collection('knowledgePermissions').findOne({
      ...helpdeskScope(user),
      kind: request.params.kind,
      resourceId: request.params.id,
    });
    response.json(
      policy
        ? {
            mode: policy.mode,
            userIds: policy.userIds,
            roles: policy.roles,
            version: policy.version,
          }
        : { mode: 'inherit', userIds: [], roles: [], version: 0 },
    );
  };
  const putKnowledgePermissionsKindId = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    await target(user, request.params.kind, request.params.id);
    const value = request.body || {};
    if (
      Object.keys(value).some((key) => !['mode', 'userIds', 'roles', 'version'].includes(key)) ||
      !['inherit', 'workspace', 'restricted'].includes(value.mode) ||
      !Number.isInteger(value.version) ||
      value.version < 0 ||
      !Array.isArray(value.userIds) ||
      value.userIds.length > 200 ||
      value.userIds.some((id) => typeof id !== 'string') ||
      !Array.isArray(value.roles) ||
      value.roles.some((role) => !['agent', 'user', 'read-only'].includes(role))
    )
      deny('Invalid knowledge permissions.', 400);
    const members = await store
      .collection('helpdeskMembers')
      .find({ ...helpdeskScope(user), active: true, userId: { $in: value.userIds } })
      .toArray();
    if (value.userIds.some((id) => !members.some((member) => member.userId === id)))
      deny('Choose active workspace users.', 400);
    const filter = {
      ...helpdeskScope(user),
      kind: request.params.kind,
      resourceId: request.params.id,
    };
    const policy = {
      mode: value.mode,
      userIds: [...new Set(value.userIds)],
      roles: [...new Set(value.roles)],
      version: value.version + 1,
      updatedAt: new Date(),
      updatedBy: user.id,
    };
    if (!value.version) {
      if (await store.collection('knowledgePermissions').findOne(filter))
        deny('Permissions changed. Reload and try again.', 409);
      // A stable ID makes concurrent first saves mutually exclusive.
      try {
        await store.collection('knowledgePermissions').insertOne({
          _id: `${user.workspaceId}:${request.params.kind}:${request.params.id}`,
          ...filter,
          ...policy,
        });
      } catch (error) {
        if (error.code === 11000) deny('Permissions changed. Reload and try again.', 409);
        throw error;
      }
    } else if (
      !(
        await store
          .collection('knowledgePermissions')
          .updateOne({ ...filter, version: value.version }, { $set: policy })
      ).matchedCount
    )
      deny('Permissions changed. Reload and try again.', 409);
    response.json(policy);
  };
  const getKnowledgeCenter = async (request, response) => {
    const user = request.helpdeskUser;
    const ownerId = user.helpdeskOwnerId || user.id;
    const records = await store
      .collection('articles')
      .find(
        { ownerId, ...(user.role === 'admin' ? {} : { status: 'Published' }) },
        { projection: { body: 0, sections: 0 } },
      )
      .toArray();
    const visible = [];
    for (const article of records)
      if (await canReadAuthoredArticle(store, user, article)) visible.push(article);
    if (request.query.article) {
      const article = visible.find((item) => item._id.toHexString() === request.query.article);
      if (!article) deny('Article not found.', 404);
      const current = await store.collection('articles').findOne({
        _id: article._id,
        ownerId,
        ...(user.role === 'admin' ? {} : { status: 'Published' }),
      });
      if (!current || !(await canReadAuthoredArticle(store, user, current)))
        deny('Article not found.', 404);
      const locationRecord = async (id, type) => {
        if (!ObjectId.isValid(id)) return null;
        const record = await store
          .collection('records')
          .findOne({ _id: new ObjectId(id), ownerId, type }, { projection: { name: 1 } });
        return record ? { id, name: record.name } : null;
      };
      const topicId = (current.topicIds || []).includes(request.query.topic)
        ? request.query.topic
        : (current.topicIds || []).length === 1
          ? current.topicIds[0]
          : null;
      return response.json({
        location: {
          base: await locationRecord(current.base, 'knowledge-base'),
          topic: await locationRecord(topicId, 'topic'),
        },
        id: current._id.toHexString(),
        title: current.title,
        body: current.body,
        base: current.base,
        topicIds: current.topicIds,
        attachments: await store
          .collection('articleAttachments')
          .find(
            {
              _id: { $in: (current.attachmentIds || []).map((id) => new ObjectId(id)) },
              ownerId,
              workspaceId: user.workspaceId,
            },
            { projection: { name: 1, size: 1 } },
          )
          .toArray()
          .then((items) =>
            items.map((file) => ({ id: file._id.toHexString(), name: file.name, size: file.size })),
          ),
      });
    }
    const references = await store
      .collection('records')
      .find({ ownerId, type: { $in: ['knowledge-base', 'topic'] } })
      .toArray();
    const name = (id, fallback) =>
      references.find((record) => record._id.toHexString() === id)?.name || fallback;
    const bases = [...new Set(visible.map((item) => item.base))].map((id) => ({
      id,
      name: name(id, 'General'),
      count: visible.filter((item) => item.base === id).length,
      description: references.find((record) => record._id.toHexString() === id)?.description || '',
      articles: visible
        .filter((item) => item.base === id)
        .slice(0, 3)
        .map((item) => ({ id: item._id.toHexString(), title: item.title })),
    }));
    const inBase = visible.filter(
      (item) => !request.query.base || item.base === request.query.base,
    );
    const topics = request.query.base
      ? [...new Set(inBase.flatMap((item) => item.topicIds || []))].map((id) => ({
          id,
          name: name(id, 'Topic'),
        }))
      : [];
    const articles =
      request.query.base || (typeof request.query.q === 'string' && request.query.q.trim())
        ? inBase
            .filter((item) => !request.query.topic || item.topicIds?.includes(request.query.topic))
            .map((item) => ({
              id: item._id.toHexString(),
              title: item.title,
              summary: item.summary || '',
              baseId: item.base,
              topicId: item.topicIds?.[0] || '',
              status: item.status || 'Draft',
              updatedAt: item.updatedAt,
            }))
        : [];
    const articleList = listResponse(
      { ...request, query: { ...request.query, list: '1', sort: 'Title', direction: 'asc' } },
      articles,
      { Title: 'title', Summary: 'summary' },
    );
    const metadata = await articleListMetadata(
      store,
      visible.filter((article) => articleList.rows.some((row) => row.id === String(article._id))),
    );
    articleList.rows = articleList.rows.map((row) => ({ ...row, ...metadata.get(row.id) }));
    response.json({ bases, topics, articles: articleList });
  };
  const getKnowledgeDirectory = async (request, response) =>
    response.json(await knowledgeDirectory(store, request.helpdeskUser, request.query));
  return {
    getKnowledgePermissionsKindId,
    putKnowledgePermissionsKindId,
    getKnowledgeCenter,
    getKnowledgeDirectory,
  };
}
