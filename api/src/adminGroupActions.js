import { saveGroup, workspaceGroups, presentGroup } from './groups.js';
import { resolveHelpdeskUser, helpdeskScope, deny } from './helpdeskRoles.js';
import { auditOperation } from './audit.js';

const creationIntent = (text) =>
  /\b(?:create|add|make|build|generate)\b[\s\S]{0,160}\b(?:group|queue|team)\b|\b(?:group|queue|team)\b[\s\S]{0,80}\b(?:create|add|make|build|generate)\b/i.test(
    text,
  );
const declined = (text) => /\b(?:do not|don't|don’t|dont|never|cancel|stop)\b/i.test(text);
function namedGroup(text) {
  const direct = text.match(
    /(?:^|[.!?]\s*)(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:create|add|make|build|generate)(?:\s+me)?\s+(?:a\s+|an\s+|the\s+)?(?:(assignment|approval)\s+)?(?:group|queue|team)\s*(?::|called|named)?\s+["“]?([^"”\n.!?]+)["”]?/i,
  );
  const name = direct?.[2].split(/\s+(?:for|with|and|that|if)\b/i)[0].trim();
  if (name && !/^(?:if|it|this|that)\b/i.test(name))
    return { name, approval: direct[1]?.toLowerCase() === 'approval' };
  const destinations = [
    ...text.matchAll(
      /\b(?:route|assign|send)\s+(?:a\s+|an\s+|the\s+)?(?:task|ticket|request|item)\s+to\s+["“]?([^"”\n.,;!?]+)/gi,
    ),
  ].map((match) => match[1].split(/\s+(?:as well|and|if|then|once|when)\b/i)[0].trim());
  const unique = [...new Set(destinations.map((name) => name.toLowerCase()))];
  if (unique.length !== 1) return null;
  return {
    name: destinations[0].replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
    approval: false,
  };
}
function requestedGroup(chat) {
  const prompts = chat.messages.filter((item) => item.role === 'user').slice(-6);
  const latest = prompts.at(-1)?.text || '';
  if (
    !creationIntent(latest) ||
    declined(latest) ||
    /^(?:how|explain|describe|what)\b/i.test(latest.trim())
  )
    return null;
  const current = namedGroup(latest);
  if (current) return current;
  if (!/\b(?:the|that|this|it)\b/i.test(latest)) return null;
  for (const prompt of prompts.slice(0, -1).reverse()) {
    if (declined(prompt.text)) continue;
    const prior = namedGroup(prompt.text);
    if (prior) return prior;
  }
  return null;
}

export async function applyAdminGroupAction(store, chat, responseText) {
  if (chat.helpdeskPurpose !== 'workflow' || chat.assistantType !== 'admin') return responseText;
  const requested = requestedGroup(chat);
  const block = responseText.match(/```(?:group|queue)\s*([\s\S]*?)```/i);
  if (!requested) {
    return block
      ? 'Tell me the name of the group you want me to create and whether it should handle assignments, approvals, or both.'
      : responseText;
  }
  const user = await resolveHelpdeskUser(
    store,
    { id: chat.ownerId, workspaceId: chat.workspaceId },
    chat.workspaceId,
  );
  if (
    user.role !== 'admin' ||
    chat.actionRole !== 'admin' ||
    helpdeskScope(user).ownerId !== chat.providerOwnerId
  )
    deny('Administrator access is required to create a group.');
  const messages = chat.messages.filter((item) => item.role === 'user').slice(-6);
  const request = messages.map((item) => item.text).join('\n');
  const proposed = block
    ? JSON.parse(block[1])
    : {
        name: requested.name,
        assignmentEnabled: !requested.approval,
        approvalEnabled: requested.approval,
      };
  if (
    !proposed ||
    Object.keys(proposed).some(
      (key) =>
        ![
          'name',
          'description',
          'routingInstructions',
          'assignmentEnabled',
          'approvalEnabled',
        ].includes(key),
    )
  )
    deny('The group details could not be validated. Please clarify the group you want.', 400);
  if (
    typeof proposed.name !== 'string' ||
    !proposed.name.trim() ||
    proposed.name.trim().toLowerCase() !== requested.name.toLowerCase()
  )
    return 'Tell me the name of the group you want me to create and whether it should handle assignments, approvals, or both.';
  const input = {
    name: proposed.name.trim(),
    description: proposed.description ?? '',
    routingInstructions: proposed.routingInstructions ?? '',
    userIds: [],
    active: true,
    assignmentEnabled: proposed.assignmentEnabled ?? true,
    approvalEnabled: proposed.approvalEnabled ?? false,
  };
  if (input.approvalEnabled && !/\bapprov(?:al|als|e|ers?)\b/i.test(request))
    deny('Ask explicitly to enable this group for approvals.', 400);
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
  const label = group.name.replace(/[\[\]\\]/g, '');
  const source = responseText.match(/```(?:typescript|ts)\s*[\s\S]*?```/i)?.[0];
  return `${created ? 'Created' : 'Found the existing group'} [${label}](/workspace/${user.workspaceId}/users/groups/${group.id}). ${group.assignmentEnabled ? 'You can now use it as an assignment group in your workflow.' : 'You can review its settings and members.'}${source ? '\n\n' + source : ''}`;
}
