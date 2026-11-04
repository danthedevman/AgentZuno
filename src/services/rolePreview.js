import { api } from './api.js';
export function getRolePreview(workspaceId) {
  try {
    const value = localStorage.getItem(`agentzuno-role-preview-${workspaceId}`);
    return ['agent', 'user', 'read-only'].includes(value) ? value : 'admin';
  } catch {
    return 'admin';
  }
}
export async function setRolePreview(workspaceId, role) {
  await api('/api/auth/impersonation', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, role }),
  });
  try {
    if (role === 'admin') localStorage.removeItem(`agentzuno-role-preview-${workspaceId}`);
    else localStorage.setItem(`agentzuno-role-preview-${workspaceId}`, role);
  } catch {}
  window.dispatchEvent(new Event('agentzuno-role-preview'));
}
