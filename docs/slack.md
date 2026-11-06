# Connect Slack

An Admin installs and configures the connector. Agents and Users can talk to Zuno after linking an active AgentZuno workspace account; their current knowledge and request permissions still apply. Read Only users cannot perform account-linking or support mutations. A Slack installation does not make anyone an AgentZuno Admin.

## Before you start

Run the web app, API, worker, database, and queue. Configure an AI provider in Settings for generated answers. Use a public HTTPS application origin so Slack can deliver events. Your users can use built-in AgentZuno login; an SSO identity provider is optional.

For local testing, install and authorize [ngrok](https://ngrok.com/docs/start), then run `ngrok http 3000`. Keep your authtoken outside Git and chat. Set the local `APP_ORIGIN` to the tunnel's HTTPS origin, restart the API and worker, and open AgentZuno through that same HTTPS address. The tunnel requires the app, ngrok process, and computer to remain running. A deployed installation uses its stable public hostname instead. See [deployment options](deployment.md).

## Create and install the Slack app

1. Open **Connectors → Slack** in AgentZuno. Expand Setup Instructions and copy the generated app manifest.
2. Create an app from that manifest in [Slack app management](https://api.slack.com/apps). Use the Slack workspace you intend to connect.
3. In Slack's Basic Information, copy the **Client ID**, **Client Secret**, and **Signing Secret** into AgentZuno's Connection Details and save. These must all belong to the same Slack app. They are encrypted in AgentZuno's database.
4. Under Slack **OAuth & Permissions → Redirect URLs**, add the exact **OAuth Callback** displayed by AgentZuno. Click **Add**, then **Save URLs**.
5. Under Slack **Event Subscriptions**, enable events and set Request URL to AgentZuno's separate **Slack Events URL**. Wait for Verified. The generated manifest includes the bot subscriptions.
6. Click **Add to Slack** in AgentZuno and approve the installation. Use **Reauthorize** after adding scopes. Saving credentials alone does not install the app.
7. Enable **Zuno Bot**, configure user links, and save. Receiving messages and responding to users must also be enabled under Allowed Actions.

### Keep the two URLs separate

| Slack setting                       | AgentZuno field  | Example path                                            |
| ----------------------------------- | ---------------- | ------------------------------------------------------- |
| OAuth & Permissions → Redirect URLs | OAuth Callback   | `/api/helpdesk/channels/oauth/callback`                 |
| Event Subscriptions → Request URL   | Slack Events URL | `/api/helpdesk/channels/slack/events/YOUR_WORKSPACE_ID` |

Both use the public HTTPS origin. Copy the complete values from your connector instead of pasting the example placeholder. Slack sends its verification challenge to the Events URL, not the OAuth Callback. The callback processes a one-time authorization code after you approve installation. See [Slack OAuth setup](https://docs.slack.dev/authentication/installing-with-oauth/).

## Review and link users in bulk

1. Existing installations should click **Reauthorize** to grant `users:read` and `users:read.email`. These allow listing members and reading email addresses for suggested matches; they do not grant AgentZuno roles. See [Slack member discovery](https://docs.slack.dev/reference/methods/users.list/).
2. Save any pending bot-settings edits, then open **Manage Slack Users**. The dedicated page identifies the connected Slack workspace by name and ID and keeps user review separate from connector configuration. Click **Find Slack Users**.
3. Review the list. Discovery excludes bots, invited/deactivated members, guests, and members identified as belonging to another Slack workspace. It does not create AgentZuno accounts.
4. Search the review and move between its server-loaded pages. Reviews show 20 members per page. Selections remain selected across pages.
5. Use **Select All Suggested Matches** to select the unambiguous email suggestions in the current search across pages. Alternatively, select individual rows or choose an existing Workspace User for an unmatched member.
6. Click **Link Selected Users**, review the number of mappings, and confirm once to save the batch.

Email matching ignores case and is an Admin-reviewed suggestion, not proof of identity. Ambiguous matches are not selected automatically. Existing links are marked Linked and cannot be overwritten by bulk matching. Remove an existing link explicitly on Manage Slack Users and save before replacing it.

A review expires after 15 minutes and is bound to the Admin, workspace, Slack installation, and bot-settings version. Changed settings or an expired review require Find Slack Users again. The installation supports up to 1,000 linked users; discovery is bounded to 10,000 Slack members and fails without saving a partial review if provider pagination exceeds its limits. Slack may limit API requests; retry later after provider errors.

## Let an unmatched user link their own account

An unmatched person can message the enabled bot. Zuno sends a short-lived linking URL privately; a channel invocation receives a response visible only to that person. The linking response does not call the AI provider or expose workspace knowledge.

1. Open the link from Zuno. It expires after 10 minutes.
2. Sign in with an existing, active AgentZuno account that belongs to the connected workspace. If you do not have one, ask an Admin for an invitation; linking does not create accounts or memberships.
3. Review the Slack member ID, Slack workspace, and signed-in AgentZuno account.
4. Click **Confirm Account Link**, then message Zuno again in Slack.

The link is single-use, uses a token in the URL fragment, and is stored only as a hash on the server. Do not forward it. A changed Slack installation, revoked membership, expired request, impersonation, or conflicting existing link prevents completion. Slack documents this [account-binding pattern](https://docs.slack.dev/authentication/binding-accounts-across-services/).

## Link a user manually

For a small test or an account that needs manual review, open the person's Slack profile, choose **More → Copy member ID**, then use **Link User** in Bot Settings. Enter that Slack Member ID and select the corresponding **Workspace User**. Save User Links. Names and typed email text are not record selections. See [finding a Slack member ID](https://slack.com/help/articles/360003827751-Create-a-link-to-a-members-profile-).

## Test permissions and replies

Send a direct message to the installed Slack app from a linked User account. Ask about a Published article that account can read. Test with a second account that lacks access and confirm the restricted information is not returned. For a channel test, invite the bot and mention it; the response is private to the requester.

Links identify users but do not change roles, assignment groups, approvals, or knowledge grants. There is no scheduled Slack-to-AgentZuno account provisioning or profile synchronization. Use your organization's identity/provisioning process for account lifecycle. Runtime messages use saved Slack IDs, not fresh email guesses, and recheck current workspace access. Revoking AgentZuno membership blocks access even if a mapping remains.

Reauthorization of the same Slack app and Slack workspace preserves existing mappings and bot activation. A different installation requires renewed review; queued work from an old installation is not silently reused.

## Troubleshooting

| Symptom                                | Check                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-origin writes are not allowed    | Open AgentZuno at the exact public origin configured in `APP_ORIGIN`, sign in there, and restart authorization. Do not mix localhost login with a tunnel callback.   |
| Slack did not receive the challenge    | Request URL must be the Slack Events URL, with the workspace ID. The OAuth Callback is a different endpoint. Check the Signing Secret and public reachability.       |
| Invalid redirect URL                   | Save the exact OAuth Callback in the same Slack app whose Client ID is saved in AgentZuno. Check for spaces, a different hostname, or an unsaved Redirect URLs edit. |
| Invalid, expired, or already-used code | Start Add to Slack/Reauthorize again from AgentZuno. Refreshing the callback page cannot reuse an authorization code.                                                |
| Client Secret rejected                 | Save the Client Secret from that same Slack app; the Signing Secret is a separate value. Start authorization again afterward.                                        |
| Discovery asks for reauthorization     | Grant the two directory scopes, then return to Find Slack Users. Existing bot connections without those scopes can still use manual linking.                         |
| User cannot finish a self-service link | Confirm active membership in the connected workspace, correct signed-in account, link expiry, and no conflicting existing mapping.                                   |
| No bot reply                           | Check bot activation, Allowed Actions, linked identity, worker health, and AI-provider configuration. Invite the bot before using a channel.                         |

Private messages, external user profiles, and connector credentials must not be copied into logs or public screenshots. Audits record configuration and mapping changes; they do not replace the provider's own administration logs.

## Submit a request in Slack

In Slack app management, enable **Interactivity & Shortcuts** and paste the **Slack Interactivity URL** from AgentZuno's Slack connector. This is a third URL, separate from Events and OAuth:

`https://YOUR_APP_ORIGIN/api/helpdesk/channels/slack/interactions/YOUR_WORKSPACE_ID`

The generated manifest includes this URL for new installations. Existing installations must save it in Slack. Native buttons and modals do not require additional member-directory scopes. See [Slack interactivity](https://docs.slack.dev/interactivity/handling-user-interaction/) and [Slack modals](https://docs.slack.dev/surfaces/modals/).

A linked user can describe what they need. Zuno can collect answers conversationally through its typed request tool, ask for missing required information, and show a reviewed **Submit Request** button. Alternatively, **Open Request Form** opens the published workflow's form in a Slack modal. Submitting creates a normal AgentZuno request, returns its request number and link, and uses the same workflow routing, approval requirements, task creation, and integration permissions as submission in the app. A chat reply alone never submits a request.

Text, multiline text, choices, booleans, and permitted record references are supported. Reference fields with 30 or more available choices, or no usable choices, offer **Complete in AgentZuno** so the lookup does not silently omit records. Future unsupported field types use that same fallback. Forms expire after 30 minutes. Changed publication versions, revoked membership, changed identity bindings, disabled connectors, or lost workflow access require a new authorized form. Duplicate submission of the same form returns the original request.

Ask Zuno about your recent requests to retrieve their current statuses. Approvals remain subject to the existing approval service; these request forms do not grant authority to approve. Fulfillment/provisioning and completion notifications occur only when configured in the published workflow. Native approval decision buttons and unrestricted large-directory lookups are not included in this request-form implementation.

Channel replies are private to the requester and appear in the channel, not hidden inside a thread. Replies support links, bold text, lists, and code, with automatic previews disabled. Model-generated Slack mention syntax is escaped.

For a multi-message request started in a channel, click **Continue in DM** before supplying private details. Slack opens the app's direct messages; your next DM continues that request with its context. This handoff is bound to your linked identity and the current installation, and expires after 30 minutes. DM follow-ups continue the active conversation for 30 minutes after the last processed message. Separate top-level channel mentions remain separate conversations. Messages you type in a public channel are public even when Zuno's replies are visible only to you.

The **View in AgentZuno’s Portal** footer opens the web Chat page. It does not expose a Slack transcript through a web chat URL. Article citations open a read-only published-article page; current knowledge permissions still apply.
