export function recordViewKey(userId, workspaceId, source, label) {
  return `agentzuno:record-view:${userId || 'guest'}:${workspaceId || ''}:${source?.split('?')[0] || label}`;
}

export function recordCardVariant(label = '') {
  if (/inbox/i.test(label)) return 'inbox';
  if (/workflow/i.test(label)) return 'workflows';
  if (/request|task/i.test(label)) return 'requests';
  if (/user|member|invitation|people/i.test(label)) return 'people';
  if (/knowledge|article|topic|base/i.test(label)) return 'knowledge';
  if (/audit|execution|log/i.test(label)) return 'audit';
  return 'records';
}
