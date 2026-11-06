import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
export async function validateWorkflowDepartment(store, user, definition) {
  const id = definition?.trigger?.departmentId;
  if (!id) return;
  if (
    !(await store
      .collection('workforceReferences')
      .findOne({ ...helpdeskScope(user), _id: id, type: 'department' }))
  )
    deny('Choose an existing department from this workspace.', 422);
}
export async function matchesWorkflowDepartment(store, user, definition) {
  const id = definition?.trigger?.departmentId;
  if (!id) return true;
  const scope = helpdeskScope(user);
  const [department, profile] = await Promise.all([
    store.collection('workforceReferences').findOne({ ...scope, _id: id, type: 'department' }),
    store.collection('workforceProfiles').findOne({ ...scope, userId: user.id }),
  ]);
  return !!department && profile?.department === id;
}
