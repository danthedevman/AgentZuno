import { displayLabel } from '../utils/displayLabels.js';
const tones = {
  active: 'positive',
  published: 'positive',
  approved: 'positive',
  complete: 'positive',
  draft: 'muted',
  review: 'warning',
  pending: 'warning',
  'in review': 'warning',
  outdated: 'warning',
  failed: 'negative',
  error: 'negative',
  rejected: 'negative',
  inactive: 'muted',
  archived: 'muted',
  retired: 'muted',
  disabled: 'muted',
  saved: 'informational',
};

export function contentStatus(item) {
  const explicit = item.publishState || item.publicationState || item.workflowState || item.status;
  const state =
    typeof explicit === 'string' && explicit.trim()
      ? explicit.trim()
      : typeof item.active === 'boolean'
        ? item.active
          ? 'Active'
          : 'Inactive'
        : item.type === 'Article'
          ? 'Draft'
          : 'Active';
  const normalized = state.toLowerCase().replaceAll('_', ' ');
  return {
    label: displayLabel(normalized),
    tone: tones[normalized] || 'muted',
  };
}
