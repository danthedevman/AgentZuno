import { workspaceGroups } from './groups.js';
import { createHash } from 'node:crypto';
import { helpdeskScope, deny } from './helpdeskRoles.js';

export const queueId = (user, name) =>
  createHash('sha256')
    .update(JSON.stringify([helpdeskScope(user), name]))
    .digest('hex')
    .slice(0, 24);
export const text = (value, max, required = false) => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (required ? /[\x00-\x1f\x7f]/u : /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u).test(value) ||
    (required && !value.trim())
  )
    deny('Invalid queue details.', 400);
  return value.trim();
};
export async function existingQueueNames(store, user) {
  return (await workspaceGroups(store, user))
    .filter((group) => group.active !== false && group.assignmentEnabled)
    .map((group) => group.name);
}
export async function requireExistingQueues(store, user, names) {
  if (!names.length) return;
  const existing = await existingQueueNames(store, user);
  if (names.some((name) => !existing.includes(name)))
    deny('Choose an existing queue, or create it first.', 400);
}
