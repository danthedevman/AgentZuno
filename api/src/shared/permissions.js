export function canReadKnowledge({ user, agent, document, connection, knowledgeBaseIds }) {
  if (!user || !agent || !connection || connection.status !== 'Connected') return false;
  if (connection.ownerId !== user.id || connection.workspaceId !== user.workspaceId) return false;
  if (
    document.ownerId !== user.id ||
    document.workspaceId !== user.workspaceId ||
    document.deletedAt
  )
    return false;
  if (
    !knowledgeBaseIds.includes(document.knowledgeBaseId) ||
    !agent.knowledgeBaseIds?.includes(document.knowledgeBaseId)
  )
    return false;
  if (connection.permissionMode === 'source') return !!connection.sourcePrincipal?.id;
  if (connection.permissionMode !== 'managed' || !connection.managedAccessAcceptedAt) return false;
  return connection.allowedUserIds?.includes(user.id) === true;
}

export function safeConnection(connection) {
  const {
    _id,
    provider,
    name,
    workspaceId,
    knowledgeBaseId,
    knowledgeBaseIds,
    destination,
    permissionMode,
    authType,
    status,
    sourcePrincipal,
    allowedUserIds,
    sync,
    createdAt,
    config,
  } = connection;
  return {
    id: _id.toHexString(),
    provider,
    name,
    workspaceId,
    knowledgeBaseId,
    knowledgeBaseIds,
    destination,
    permissionMode,
    authType,
    status,
    sourcePrincipal,
    allowedUserIds,
    sync,
    createdAt,
    config,
  };
}
