# Connections and identity

This guide is for Admins configuring the installation or its connections. Agents and Users use the published features their permissions allow; Read Only users inspect permitted records without changing configuration. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

Configure application credentials by opening the relevant Connector page. Values are encrypted in MongoDB and are not returned as plaintext to the browser. Setup instructions and callback URLs are shown in the application.

| Connector       | Current capability                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Slack           | Workspace OAuth installation, signed HTTP bot events, authorized user mapping, channel interactions, and declared workflow messages |
| Gmail           | OAuth support-inbox polling and threaded replies through Zuno when enabled                                                          |
| Outlook         | OAuth support-inbox polling and replies through Zuno when enabled                                                                   |
| Microsoft Teams | Account connection; a native conversational Teams bot is not implemented                                                            |

The Slack handler uses HTTP Events API delivery, not Socket Mode. Local testing requires a public HTTPS tunnel and matching origin, OAuth callback, and Events URL configuration. A temporary tunnel changes URLs when restarted; update Slack configuration accordingly. Application credentials stay in the Connector UI.

Inbox processing does not grant the sender the workspace owner's permissions. Unmapped identities are restricted; identity-provider login and channel identity mapping remain separate from knowledge authorization. Verify provider scopes and the actual enabled behavior before production use.

## Identity providers and invitations

OIDC configuration belongs in workspace Settings. It uses validated identity binding and scoped membership; signing in does not automatically grant source knowledge access. Provisioning APIs and workforce attributes have separate validation and authorization.

When an identity provider is enabled, manual Add User invitations are hidden and rejected. Otherwise, admins can invite employees through Users after configuring SMTP. Invitations are scoped, expiring, and recipient-bound; delivery requires a working saved SMTP configuration.

## Historical knowledge imports

Unused knowledge-source integrations have been removed from new Connector setup. Compatibility readers remain for historical saved source records. They retain their source permission requirements; these are not supported new setup options.

The existing [ServiceNow deployment guide](servicenow-setup.md) describes that legacy adapter's administrator-installed permission bridge and live-validation requirements. It does not mean ServiceNow workflow execution or a new ServiceNow Connector is available.

## Connector action controls

Admins can configure **Allowed Actions** on each connector. Implemented actions default to enabled, including existing connections. Slack separates receiving bot messages, replying to users, and workflow notifications. Gmail and Outlook separate receiving support email and replying. Microsoft Teams currently has account connection only, so it does not advertise bot action controls.

These permissions are enforced at ingestion, generation and delivery, including queued work. Bot/inbox activation, provider consent, current identity bindings and workspace permissions still apply. Receiving messages means ingesting support conversations; it does not crawl Slack history or publish it as shared knowledge.

For Slack workflow notifications, `ctx.slack.postMessage('notify', {channel: 'requester', text: 'Your request is complete'})` resolves the requester through the connector's current identity bindings. A linked Slack user ID can also be an explicitly declared destination. Missing or inactive bindings deny delivery. Public/private channel destinations still require bot membership. Put a completion notification after the fulfillment steps in the executable workflow. Slack delivery is not transactional; uncertain outcomes require review. See [Slack message destinations](https://docs.slack.dev/reference/methods/chat.postMessage/).
