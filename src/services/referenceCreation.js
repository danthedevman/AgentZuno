export function referenceCreationPath(type, role) {
  if (type === 'ref-task' && ['admin', 'agent'].includes(role)) return '/workspace/tasks/new';
  if (role !== 'admin') return '';
  const routes = {
    users: '/workspace/users/new',
    'ref-user': '/workspace/users/new',
    'ref-group': '/workspace/users/groups/new',
    'ref-queue': '/workspace/users/groups/new',
    'ref-workflow': '/workspace/workflows/new',
    'ref-knowledge-topic': '/workspace/knowledge/topics/new',
    topicIds: '/workspace/knowledge/topics/new',
    knowledgeBaseId: '/workspace/create/knowledge-base',
    article: '/workspace/create/article',
  };
  if (routes[type]) return routes[type];
  if (
    typeof type === 'string' &&
    /^(ref-[a-z-]+|[a-f0-9]{24})$/.test(type) &&
    type !== 'ref-request'
  )
    return `/workspace/data/${type}/records/new`;
  return '';
}
export function referenceTypeFromOptions(options) {
  const href = options?.find((option) => option.href)?.href || '';
  return (
    href.match(/\/data\/([^/]+)\/records\//)?.[1] ||
    (href.includes('/knowledge/bases/')
      ? 'knowledgeBaseId'
      : href.includes('/knowledge/topics/')
        ? 'topicIds'
        : href.includes('/users/groups/')
          ? 'ref-group'
          : /\/users\/[a-f0-9]{24}/.test(href)
            ? 'users'
            : '')
  );
}
