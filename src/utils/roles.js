import { displayLabel } from './displayLabels.js';

export const roleOptions = ['admin', 'agent', 'user', 'read-only'].map((value) => ({
  value,
  label: displayLabel(value),
}));

export function canAssignGroups(role) {
  return role === 'admin' || role === 'agent';
}
