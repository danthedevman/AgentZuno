import { canWorkRequest } from './requestPolicy.js';
export function safeRequest(record, user) {
  const { _id, ownerId, workspaceId, notifications, workNotes = [], ...rest } = record;
  const canReadInternal = canWorkRequest(user, record);
  return {
    id: _id.toHexString(),
    ...rest,
    number:
      record.number?.replace(/^(?:ZUN|Ticket)-/, 'REQ-') ||
      `REQ-${_id.toHexString().toUpperCase()}`,
    description: record.description || record.messages?.[0]?.text || '',
    messages: record.description ? record.messages || [] : (record.messages || []).slice(1),
    events: (record.events || []).filter(
      (event) => canReadInternal || event.type !== 'work-note-added',
    ),
    ...(canReadInternal ? { workNotes } : {}),
    permissions: {
      canComment: record.status !== 'resolved',
      canWork: canReadInternal,
      canAddWorkNote: canReadInternal,
    },
  };
}
