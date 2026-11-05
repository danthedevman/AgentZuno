# Agents and permissions

AgentZuno has two application agents. The Admin agent helps authorized Admins design workflows, articles and table schemas. Zuno handles employee support using permitted published knowledge and workflows. Agents working requests have the actions their current assignment permits. Read Only members can inspect permitted records without creating or changing them. See [roles and features](roles-and-features.md).

## Actions use tools

The server supplies a tool registry for the current agent, conversation and effective role. The model requests a named tool with structured arguments. The server validates the arguments, reloads authorization, runs the existing application service and returns a verified result. Text saying “I created it” is never evidence that something was created. Markdown, JSON snippets and code fences cannot execute actions.

In a workflow conversation, an Admin can ask to create a group and build a workflow in the same message. `createGroup` saves through the same group service as the form, returns the saved link and avoids duplicate names. It adds no members implicitly. `proposeWorkflow` validates executable TypeScript and its references for the draft editor. Publication remains an explicit action.

Article tools produce sanitized previews that need approval before saving. Data-table tools produce definitions for review and Save. Support request tools prepare only currently allowed actions, such as a comment or assigned-task update, for explicit confirmation. Approvals and rejections remain decisions made by an eligible person through the application.

## Separation of duties

- Support chats cannot use Admin configuration tools, even when the person chatting is an Admin.
- Admin configuration does not approve requests or execute draft workflows. Published workflow execution rechecks its own gateway permissions.
- Impersonation reduces the effective role across the session. An existing Admin tab cannot restore Admin authority by changing a header.
- The server checks current membership and the initiating session again during queued work. Expired sessions, role changes and revoked access stop work; an old conversation cannot preserve elevated permissions.
- Knowledge access still intersects base, topic and article permissions. External senders require verified bindings; they never inherit the workspace owner’s access.
- Neither agent can assign itself roles, impersonate someone, approve on a person’s behalf or bypass publication, review or deletion safeguards through this registry.

Tool calls are bounded by rounds, count and argument size. Audits record the actor, effective role, tool and outcome without storing private tool arguments or credentials. Provider-native tool calls and results are supported for OpenAI, Anthropic and Gemini; there is no response-prose extraction fallback. A provider or model that does not support these tools fails the action instead of silently switching to text parsing.

The registry is not unrestricted administration or web access. Only implemented tools are exposed. More tools require server validation, authorization, the ordinary application service, auditing and behavioral tests on both database engines.

## Review tool activity and retention

Expand **Tools Used** beneath an Admin agent response to see each call, its processing/completed/failed state and completion time. The list remains with the conversation. Execution audits link parent and root operations, response IDs and tool-call IDs, so **Related Activity** includes nested calls and their record mutations without exposing arguments or private reasoning. Existing historical records retain only the correlation metadata captured at the time.

Admins can open **Settings → Audit → Retention** to enable automatic cleanup and choose 1–3,650 days. Cleanup defaults off, so logs remain indefinitely. Enabling or changing a live retention period requires confirmation because deletion is permanent. A durable worker checks due policies and removes completed records in batches of up to 1,000, scoped to that workspace. It records the cleanup and deletion count. In-progress audit operations and operational requests, approvals, versions and chat histories are not deleted. Disabling stops future batches; a batch already running may finish. Export or back up required audit history before enabling retention. Agents, Users and Read Only members cannot configure cleanup.
