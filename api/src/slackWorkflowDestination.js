import { resolveHelpdeskUser, deny } from './helpdeskRoles.js';

export async function slackWorkflowDestination(store, source, target, requesterId) {
  if (/^[CG][A-Z0-9]{2,39}$/.test(target)) return target;
  const bindings = source.bot?.identityBindings || [];
  const binding =
    target === 'requester'
      ? bindings.find((item) => item.userId === requesterId)
      : bindings.find((item) => item.slackUserId === target);
  if (!binding || !/^[UW][A-Z0-9]{2,39}$/.test(binding.slackUserId))
    deny('Link the recipient to an active workspace user in Slack settings first.');
  const person = await resolveHelpdeskUser(
    store,
    { id: binding.userId, workspaceId: source.workspaceId },
    source.workspaceId,
  );
  if (person.helpdeskOwnerId !== source.ownerId) deny('Slack recipient access changed.');
  return binding.slackUserId;
}
