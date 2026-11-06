import { listResponse } from '../../shared/listQuery.js';
import { requireRole } from '../../identity/helpdeskRoles.js';

import { connectionStatus } from '../../integrations/connectionStatus.js';

export function createKnowledgeListsController(loadWorkspace) {
  const getKnowledgeBasesId = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    if (
      request.helpdeskUser.workspaceId !== request.user.workspaceId ||
      request.user.helpdeskRolePreview
    )
      return response.status(404).json({ error: 'Knowledge base not found.' });
    const workspace = await loadWorkspace(request.user, ['knowledgeBases']);
    const base = workspace.knowledgeBases.find((base) => base.id === request.params.id);
    if (!base) return response.status(404).json({ error: 'Knowledge base not found.' });
    response.json(base);
  };
  const getListsKind = async (request, response) => {
    const user = request.helpdeskUser;
    const kind = request.params.kind;
    if (!['bases', 'articles', 'topics', 'connections', 'search'].includes(kind))
      return response.status(404).json({ error: 'List not found.' });
    if (kind === 'connections') requireRole(user, ['admin']);
    if (user.workspaceId !== request.user.workspaceId || request.user.helpdeskRolePreview)
      return response.json(
        listResponse(request, [], {
          Name: 'title',
          Status: 'status',
          Articles: 'articleCount',
          'Knowledge Base': 'baseName',
          Updated: 'updatedAt',
          Connection: 'title',
          Category: 'category',
          Type: 'type',
          Summary: 'summary',
        }),
      );
    const sections =
      kind === 'connections'
        ? ['integrations']
        : kind === 'search'
          ? ['articles', 'files', 'images']
          : kind === 'bases'
            ? ['knowledgeBases', 'articles']
            : kind === 'topics'
              ? ['topics', 'articles']
              : ['articles', 'knowledgeBases', 'topics'];
    const workspace = await loadWorkspace(request.user, sections, kind !== 'search');
    const articles = workspace.articles || [];
    const matchingTopic = (article, topic) =>
      Array.isArray(article.topicIds)
        ? article.topicIds.includes(topic.id)
        : topic.articleIds?.includes(article.id);
    if (kind === 'search') {
      const items = ['articles', 'files', 'images'].flatMap((key) =>
        workspace[key].map((item) => ({
          id: item.id,
          title: item.title || item.filename || item.name,
          summary: item.summary || '',
          type: key === 'articles' ? 'Article' : key === 'files' ? 'File' : 'Image',
          icon: key === 'articles' ? 'book' : key === 'files' ? 'file' : 'image',
          href: `/workspace/${key}/${item.id}`,
          searchText: JSON.stringify([
            item.title,
            item.summary,
            item.body,
            item.sections,
            item.content,
          ]),
        })),
      );
      const result = listResponse(
        request,
        items,
        {
          Name: 'title',
          Type: 'type',
          type: 'type',
          Summary: 'summary',
          summary: 'summary',
          Content: 'searchText',
        },
        { sort: 'Name' },
      );
      if (Array.isArray(result)) return response.json([]);
      return response.json({ ...result, rows: result.rows.map(({ searchText, ...item }) => item) });
    }
    let rows;
    if (kind === 'bases')
      rows = workspace.knowledgeBases.map((base) => ({
        ...base,
        title: base.name,
        icon: 'book-pen',
        kind: 'Knowledge Base',
        articleCount: articles.filter((article) => article.base === base.id).length,
        href: `/workspace/knowledge/bases/${encodeURIComponent(base.id)}`,
        editHref: base.editable ? `/workspace/records/knowledge-base/${base.id}/edit` : null,
      }));
    if (kind === 'topics')
      rows = workspace.topics
        .filter(
          (topic) =>
            !request.query.base ||
            topic.knowledgeBaseId === request.query.base ||
            articles.some(
              (article) => article.base === request.query.base && matchingTopic(article, topic),
            ),
        )
        .map((topic) => ({
          ...topic,
          title: topic.name,
          icon: 'layers',
          kind: 'Topic',
          articleCount: articles.filter((article) => matchingTopic(article, topic)).length,
          href: `/workspace/knowledge/topics/${encodeURIComponent(topic.id)}`,
          editHref: topic.editable ? `/workspace/records/topic/${topic.id}/edit` : null,
        }));
    if (kind === 'articles')
      rows = articles
        .filter(
          (article) =>
            (!request.query.base || article.base === request.query.base) &&
            (!request.query.topic ||
              workspace.topics.some(
                (topic) => topic.id === request.query.topic && matchingTopic(article, topic),
              )),
        )
        .map((article) => ({
          ...article,
          description: article.summary,
          icon: 'book-pen',
          kind: 'Article',
          status:
            article.status ||
            article.publicationState ||
            (article.sourceConnectionId ? 'Source Managed' : 'Draft'),
          baseName: workspace.knowledgeBases.find((base) => base.id === article.base)?.name || '',
          details: [workspace.knowledgeBases.find((base) => base.id === article.base)?.name || ''],
          href: `/workspace/articles/${article.id}`,
          editHref:
            article.body && !article.sourceConnectionId
              ? `/workspace/articles/${article.id}/edit`
              : null,
        }));
    if (kind === 'connections') {
      const saved = workspace.integrations.filter((item) => item.type === 'connection');
      rows = [
        ...saved
          .filter((item) => item.provider === 'custom')
          .map((item) => ({
            id: 'custom',
            name: item.name || 'Custom connection',
            category: 'Custom knowledge',
            connection: item,
          })),
      ]
        .filter((item) => !request.query.category || item.category === request.query.category)
        .map((item) => ({
          ...item,
          status: connectionStatus(
            item.connection
              ? [item.connection]
              : saved.filter((connection) => connection.provider === item.id),
          ),
        }));
      return response.json(
        listResponse(
          request,
          rows,
          {
            Connection: 'name',
            Category: 'category',
            Type: 'type',
            Summary: 'summary',
            Status: (item) => item.status.label,
          },
          { sort: 'Connection' },
        ),
      );
    }
    response.json(
      listResponse(
        request,
        rows,
        {
          Name: 'title',
          Status: 'status',
          Articles: 'articleCount',
          'Knowledge Base': 'baseName',
          Updated: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : null),
        },
        { sort: 'Name' },
      ),
    );
  };
  return { getKnowledgeBasesId, getListsKind };
}
