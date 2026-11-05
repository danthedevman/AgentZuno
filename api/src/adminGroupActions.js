import { saveGroup, workspaceGroups, presentGroup } from './groups.js';
import { resolveHelpdeskUser, helpdeskScope, deny } from './helpdeskRoles.js';
import { auditOperation } from './audit.js';

export async function applyAdminGroupAction(store, chat, responseText) {
  if (chat.helpdeskPurpose !== 'workflow' || chat.assistantType !== 'admin') return responseText;
  let block = responseText.match(/```(?:group|queue)\s*([\s\S]*?)```/i);
  const latestPrompt = chat.messages.filter((item) => item.role === 'user').at(-1)?.text || '';
  if (!block) {
    const match = latestPrompt.match(
      /^(?:please\s+)?(?:create|add|make|build|generate)(?:\s+me)?\s+(?:a\s+|an\s+|the\s+)?(?:(assignment|approval)\s+)?(?:group|queue|team)\s*(?::|called|named)?\s+["“]?([^"”\n.!?]+)["”]?/i,
    );
    const conditional =
      /\bif\b[\s\S]{0,80}\b(?:group|queue|team)\b[\s\S]{0,40}\b(?:doesn['’]?t|does not|isn['’]?t|is not)\b[\s\S]{0,30}\bexist\b[\s\S]{0,50}\bcreate\b/i.test(
        latestPrompt,
      );
    const destination =
      conditional &&
      latestPrompt.match(
        /\b(?:route|assign|send)\s+(?:a\s+|the\s+)?(?:task|request|item)\s+to\s+["“]?([^"”\n.,;]+)/i,
      );
    if (!match && !destination) return responseText;
    const name = match
      ? match[2].split(/\s+(?:for|with|and|that)\s+/i)[0].trim()
      : destination[1]
          .split(/\s+(?:as well|and|if|then)\b/i)[0]
          .trim()
          .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
    block = [
      '',
      JSON.stringify({
        name,
        assignmentEnabled: match?.[1]?.toLowerCase() !== 'approval',
        approvalEnabled: match?.[1]?.toLowerCase() === 'approval',
      }),
    ];
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
  const latest = messages.at(-1)?.text || '';
  const proposed = JSON.parse(block[1]);
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
    !request.toLowerCase().includes(proposed.name.trim().toLowerCase()) ||
    !/\b(?:create|add|make|build|generate)\b[\s\S]{0,160}\b(?:group|queue|team)\b|\b(?:group|queue|team)\b[\s\S]{0,80}\b(?:create|add|make|build|generate)\b/i.test(
      request,
    ) ||
    /\b(?:do not|don't|dont|never|cancel|stop)\b/i.test(latest)
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
