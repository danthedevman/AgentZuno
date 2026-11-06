# Connections and identity

This guide is for Admins configuring the installation or its connections. Agents and Users use the published features their permissions allow; Read Only users inspect permitted records without changing configuration. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

Configure application credentials by opening the relevant Connector page. Values are encrypted in the configured database and are not returned as plaintext to the browser. Setup instructions and callback URLs are shown in the application.

| Connector       | Current capability                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Slack           | Workspace OAuth installation, signed HTTP bot events, authorized user mapping, channel interactions, and declared workflow messages |
| Gmail           | OAuth support-inbox polling and threaded replies through Zuno when enabled                                                          |
| Outlook         | OAuth support-inbox polling and replies through Zuno when enabled                                                                   |
| Microsoft Teams | Tenant-bound native bot, explicit employee mapping and private support answers                                                      |

The Slack handler uses HTTP Events API delivery, not Socket Mode. Local testing requires a public HTTPS tunnel and matching origin, OAuth callback, and Events URL configuration. A temporary tunnel changes URLs when restarted; update Slack configuration accordingly. Application credentials stay in the Connector UI.

Inbox processing does not grant the sender the workspace owner's permissions. Unmapped identities are restricted; identity-provider login and channel identity mapping remain separate from knowledge authorization. Verify provider scopes and the actual enabled behavior before production use.

For Slack installation, reviewed bulk user matching, self-service linking, required scopes, and common errors, follow [Connect Slack](slack.md).

## Identity providers and invitations

OIDC configuration belongs in workspace Settings. It uses validated identity binding and scoped membership; signing in does not automatically grant source knowledge access. Provisioning APIs and workforce attributes have separate validation and authorization.

When an identity provider is enabled, manual Add User invitations are hidden and rejected. Otherwise, admins can invite employees through Users. With SMTP configured, invitations are emailed; otherwise, the Admin receives a link to copy and share privately. Invitations are scoped, expiring, and recipient-bound.

In **Users & Groups → Invitations**, pending invitations offer **Generate New Link**, **Resend Email** when SMTP is configured, and **Remove Invitation**. Each action requires confirmation. A replacement expires in seven days and invalidates the previous link; the new manual link appears above the list for copying. Removing an invitation revokes its link and removes it from the list while retaining its historical record. Actions are unavailable during email delivery and after acceptance. User removal requires confirmation, removes workspace membership, and preserves the account and audit history. You cannot remove yourself or the workspace owner; identity-provider-managed users must be managed in the identity provider.

## Historical knowledge imports

Unused knowledge-source integrations have been removed from new Connector setup. Compatibility readers remain for historical saved source records. They retain their source permission requirements; these are not supported new setup options.

The existing [ServiceNow deployment guide](servicenow-setup.md) describes that legacy adapter's administrator-installed permission bridge and live-validation requirements. It does not mean ServiceNow workflow execution or a new ServiceNow Connector is available.

## Connector action controls

Admins can configure **Allowed Actions** on each connector. Implemented actions default to enabled, including existing connections. Slack separates receiving bot messages, replying to users, and workflow notifications. Gmail and Outlook separate receiving support email and replying. Microsoft Teams separates receiving bot messages and sending private support replies.

These permissions are enforced at ingestion, generation and delivery, including queued work. Bot/inbox activation, provider consent, current identity bindings and workspace permissions still apply. Receiving messages means ingesting support conversations; it does not crawl Slack history or publish it as shared knowledge.

For Slack workflow notifications, `ctx.slack.postMessage('notify', {channel: 'requester', text: 'Your request is complete'})` resolves the requester through the connector's current identity bindings. A linked Slack user ID can also be an explicitly declared destination. Missing or inactive bindings deny delivery. Public/private channel destinations still require bot membership. Put a completion notification after the fulfillment steps in the executable workflow. Slack delivery is not transactional; uncertain outcomes require review. See [Slack message destinations](https://docs.slack.dev/reference/methods/chat.postMessage/).

## Microsoft Teams bot setup

An Admin configures the bot in **Connectors → Microsoft Teams**. Agents and Users can chat privately after their identity is mapped; Read Only members cannot start bot work. This implementation supports the commercial Microsoft cloud, not sovereign clouds or the Bot Framework Emulator.

1. Create a single-tenant application in [Microsoft Entra](https://entra.microsoft.com/) and an [Azure Bot](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-quickstart-registration?view=azure-bot-service-4.0) using that application ID. Enable the Microsoft Teams channel.
2. Save the application ID and client secret in the connector. Credentials are encrypted; they are loaded only on the server. Configure a public HTTPS application origin and use the displayed Events URL as the bot messaging endpoint. Local development needs a public HTTPS tunnel.
3. Enter the Entra tenant ID. Add explicit mappings from each employee’s Entra object ID to an active AgentZuno workspace user. Email similarity, a Teams display name, and SSO alone do not establish this binding.
4. Enable the bot and its receiving/reply actions. Package and install a [Teams app with the bot](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/create-a-bot-for-teams) in your tenant. Start a personal chat with it.
5. Test with two mapped employees who have different knowledge permissions, an unmapped employee, a disabled mapping, and a revoked membership before enabling organization use.

Every inbound activity needs a Microsoft-signed token with the expected issuer, application audience, lifetime, Teams channel endorsement, matching service URL and configured tenant. Private replies use the mapped person’s current workspace permissions. A channel mention receives an invitation to chat privately rather than a knowledge answer visible to the whole channel. The bot does not ingest channel history or grant access to private requests.

Queued work stores source IDs and reloads current credentials, mappings and action policies. Changing bot settings invalidates queued work from the previous configuration. A send with an uncertain outcome is marked for review and is not automatically sent again. Review and reconcile the conversation in Teams before attempting manual recovery. Automated tests use signed fictional activities and mocked Microsoft endpoints; an actual tenant installation still needs live validation.

## Native request forms in Slack and Teams

Linked active users can complete published request workflows inside Slack modals or Teams Adaptive Cards. The assistants can collect answers in conversation and prefill a review; submission still requires the user's **Submit Request** action. Text, multiline text, choices, booleans, and bounded permitted record lookups use the same validation and workflow submission service as the app. Unsupported or large reference forms offer an app link instead of dropping fields. Teams cards that exceed the supported payload budget also use an app link.

Slack requires its dedicated Interactivity URL in addition to Events and OAuth; see [Connect Slack](slack.md). Teams uses the existing authenticated personal bot activity endpoint and Adaptive Card submit messages; no new public unauthenticated endpoint is added. Forms expire after 30 minutes, recheck current permissions and publication versions, and deduplicate repeated submissions. Follow-up status questions can retrieve the user's own recent requests. Approval decisions still use the existing approval service and are not implied by a requester submitting a form.
