export function getRolePreview(workspaceId) {
  try {
    const value = localStorage.getItem(`agentzuno-role-preview-${workspaceId}`);
    return ['agent', 'user', 'read-only'].includes(value) ? value : 'admin';
  } catch {
    return 'admin';
  }
}
export async function setRolePreview(workspaceId, role) {
  const response = await fetch('/api/auth/impersonation', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId, role }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Impersonation could not be changed.');
  try {
    if (role === 'admin') localStorage.removeItem(`agentzuno-role-preview-${workspaceId}`);
    else localStorage.setItem(`agentzuno-role-preview-${workspaceId}`, role);
  } catch {}
  window.dispatchEvent(new Event('agentzuno-role-preview'));
}
