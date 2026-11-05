import { saveGroup, workspaceGroups, presentGroup } from './groups.js';
import { helpdeskScope, deny } from './helpdeskRoles.js';
import { resolveChatActor } from './chatAuthorization.js';
import { auditOperation } from './audit.js';

async function persistAdminGroup(store, user, chat, input) {
  const previous = (await workspaceGroups(store, user)).find(
    (item) => item.name.toLowerCase() === input.name.toLowerCase(),
  );
  const origin = { chatId: String(chat._id), responseId: chat.responseId };
  let group = previous ? presentGroup(previous) : null;
  if (!group) {
    try {
      group = await auditOperation(
        store,
        { ...user, ownerId: helpdeskScope(user).ownerId },
        'admin-chat-create-group',
        '/groups',
        () => saveGroup(store, user, input, undefined, origin),
        {
          triggerType: 'admin-chat',
          triggerLabel: 'Administrator requested group creation',
          sourceChatId: String(chat._id),
        },
      );
    } catch (error) {
      if (error.status !== 409) throw error;
      const saved = (await workspaceGroups(store, user)).find(
        (item) => item.name.toLowerCase() === input.name.toLowerCase(),
      );
      if (!saved) throw error;
      group = presentGroup(saved);
    }
  }
  const created =
    !previous ||
    (previous.createdFromChat?.chatId === origin.chatId &&
      previous.createdFromChat?.responseId === origin.responseId);
  return { group, created };
}

export async function createAdminGroup(store, chat, input) {
  if (
    chat.assistantType !== 'admin' ||
    chat.helpdeskPurpose !== 'workflow' ||
    chat.actionRole !== 'admin'
  )
    deny('Administrator access is required to create a group.');
  const user = await resolveChatActor(store, chat);
  if (user.role !== 'admin' || helpdeskScope(user).ownerId !== chat.providerOwnerId) deny();
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'name',
          'description',
          'routingInstructions',
          'assignmentEnabled',
          'approvalEnabled',
        ].includes(key),
    ) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    input.name.length > 80 ||
    typeof input.description !== 'string' ||
    input.description.length > 1000 ||
    typeof input.routingInstructions !== 'string' ||
    input.routingInstructions.length > 2000 ||
    ['assignmentEnabled', 'approvalEnabled'].some((key) => typeof input[key] !== 'boolean')
  )
    deny('Invalid group fields.', 400);
  const { group, created } = await persistAdminGroup(store, user, chat, {
    ...input,
    name: input.name.trim(),
    userIds: [],
    active: true,
  });
  return {
    action: 'createGroup',
    status: created ? 'created' : 'existing',
    id: group.id,
    name: group.name,
    assignmentEnabled: group.assignmentEnabled,
    approvalEnabled: group.approvalEnabled,
    href: `/workspace/${user.workspaceId}/users/groups/${group.id}`,
  };
}
