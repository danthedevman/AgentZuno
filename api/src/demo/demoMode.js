import { createHash } from 'node:crypto';

export const collections = [
  'records',
  'articles',
  'knowledgePermissions',
  'workforceReferences',
  'approvalGroups',
  'helpdeskWorkflows',
  'workflowRevisions',
  'helpdeskWorkflowRevisions',
  'helpdeskRequests',
  'helpdeskTasks',
  'chats',
  'users',
  'helpdeskMembers',
  'helpdeskWorkflowConversations',
  'demoMembershipAdjustments',
];
export const demoFilter = (scope, name) => ({
  ...(name === 'users'
    ? { ownerId: scope.ownerId, demoWorkspaceId: scope.workspaceId }
    : name === 'chats'
      ? { workspaceId: scope.workspaceId, providerOwnerId: scope.ownerId }
      : scope),
  demoDatasetId: { $exists: true },
});
export const recordId = (scope, industry, key) =>
  createHash('sha256')
    .update(JSON.stringify([scope, industry, key]))
    .digest('hex')
    .slice(0, 24);
