const invalid = (message) => {
  throw Object.assign(new Error(message), { status: 400, publicMessage: message });
};

export function topicPath(topics, id) {
  const path = [];
  let current = topics.find((topic) => topic.id === id);
  const seen = new Set();
  while (current) {
    if (seen.has(current.id) || path.length === 3) return null;
    seen.add(current.id);
    path.unshift(current);
    if (!current.parentTopicId) return path;
    current = topics.find((topic) => topic.id === current.parentTopicId);
    if (!current) return null;
  }
  return null;
}

export function topicPlacement(workspace, input, existing) {
  if (input.parentTopicId !== undefined && typeof input.parentTopicId !== 'string')
    invalid('Choose a parent topic from this workspace.');
  if (input.knowledgeBaseId !== undefined && typeof input.knowledgeBaseId !== 'string')
    invalid('Choose a knowledge base from this workspace.');
  const parentTopicId = input.parentTopicId ?? existing?.parentTopicId ?? '';
  // Parent placement is chosen when creating a folder; renaming never moves its subtree.
  if (existing && parentTopicId !== (existing.parentTopicId || ''))
    invalid('A saved topic cannot be moved to another parent.');
  const parent = parentTopicId && workspace.topics.find((topic) => topic.id === parentTopicId);
  const base =
    input.knowledgeBaseId ||
    existing?.knowledgeBaseId ||
    parent?.knowledgeBaseId ||
    (parent &&
      (workspace.articles.find((article) => article.topicIds?.includes(parent.id))?.base ||
        workspace.knowledgeBases[0]?.id)) ||
    '';
  if (base && !workspace.knowledgeBases.some((item) => item.id === base))
    invalid('Choose a knowledge base from this workspace.');
  if (parentTopicId) {
    const path = topicPath(workspace.topics, parentTopicId);
    if (
      !parent ||
      !path ||
      path.length >= 3 ||
      !base ||
      path.some(
        (topic) =>
          (topic.knowledgeBaseId ||
            workspace.articles.find((article) => article.topicIds?.includes(topic.id))?.base ||
            workspace.knowledgeBases[0]?.id) !== base,
      )
    )
      invalid('Choose a parent in this knowledge base. Topics support up to three levels.');
  }
  if (
    existing?.knowledgeBaseId &&
    base !== existing.knowledgeBaseId &&
    workspace.topics.some((topic) => topic.parentTopicId === String(existing._id))
  )
    invalid('A knowledge base cannot be changed while a topic has subtopics.');
  return { knowledgeBaseId: base, parentTopicId };
}
