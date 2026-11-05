import { canReviewWorkflowApproval } from './approvalTargets.js';

export function canWorkRequest(user, record) {
  return (
    user?.role === 'admin' ||
    (user?.role === 'agent' && (user.queues || []).includes(record.queueName))
  );
}

export async function canReadRequest(store, user, record) {
  if (!user || !record || record.ownerId !== (user.helpdeskOwnerId || user.id) || record.workspaceId !== user.workspaceId) return false;
  return user.role === 'read-only' || record.requesterId === user.id || canWorkRequest(user, record) || await canReviewWorkflowApproval(store, user, record._id);
}
