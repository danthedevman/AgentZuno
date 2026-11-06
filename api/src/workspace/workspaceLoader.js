import { readWorkspace } from '../data/data.js';

import { safeConnection } from '../shared/permissions.js';
export function createWorkspaceLoader(store, integrations) {
  async function loadWorkspace(user, requestedSections, metadataOnly = false) {
    const sections = new Set(
      requestedSections || [
        'articles',
        'knowledgeBases',
        'files',
        'images',
        'integrations',
        'tasks',
        'topics',
      ],
    );
    const workspace = await readWorkspace(user);
    workspace.topics ||= [];
    if (user?.helpdeskRolePreview)
      return {
        ...workspace,
        articles: [],
        files: [],
        images: [],
        knowledgeBases: [],
        integrations: [],
        topics: [],
      };
    if (user) workspace.id = user.workspaceId;
    if (user) {
      if (sections.has('articles'))
        workspace.articles.unshift(...(await store.articles(user.id, metadataOnly)));
      const keys = {
        'knowledge-base': 'knowledgeBases',
        file: 'files',
        connection: 'integrations',
        topic: 'topics',
      };
      for (const connection of sections.has('integrations')
        ? await integrations.connections(user.id)
        : [])
        workspace.integrations.unshift({
          ...safeConnection(connection),
          type: 'connection',
          description:
            connection.permissionMode === 'managed'
              ? 'AgentZuno-managed private copy'
              : 'Source-enforced access',
        });
      const types = Object.keys(keys).filter((type) => sections.has(keys[type]));
      for (const record of types.length ? await store.records(user.id, types) : [])
        if (keys[record.type]) {
          const items = workspace[keys[record.type]];
          const index = items.findIndex((item) => item.id === record.id);
          if (index < 0) items.unshift(record);
          else items.splice(index, 1, record);
        }
    }
    for (const section of [
      'articles',
      'knowledgeBases',
      'files',
      'images',
      'integrations',
      'tasks',
      'topics',
    ])
      if (!sections.has(section)) workspace[section] = [];
    return workspace;
  }
  return loadWorkspace;
}
export function requestedSections(request) {
  if (request.query.sections === undefined) return undefined;
  if (request.query.sections === 'none') return [];
  if (typeof request.query.sections !== 'string' || request.query.sections.length > 150)
    throw Object.assign(new Error('Invalid workspace sections.'), { status: 400 });
  const sections = request.query.sections.split(',');
  if (
    sections.some(
      (section) =>
        ![
          'articles',
          'knowledgeBases',
          'files',
          'images',
          'integrations',
          'tasks',
          'topics',
        ].includes(section),
    )
  )
    throw Object.assign(new Error('Invalid workspace sections.'), { status: 400 });
  return sections;
}
