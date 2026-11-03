# AgentZuno

A Solid.js knowledge workspace with an independent Express API and MongoDB. The landing page uses locally hosted Shippori Mincho and a CSS-animated neural web.

## Run with Docker

```sh
docker compose up --build -d
```

- Web: [localhost:3000](http://localhost:3000)
- API: [localhost:3001](http://localhost:3001/health)
- MongoDB: `127.0.0.1:27017`, persisted in the `mongo-data` volume
- Override `PORT`, `API_PORT`, or `MONGO_PORT` to change published ports.

Run the API independently of the frontend with `docker compose up --build -d api`; its MongoDB dependency starts automatically. The API has its own `api/package.json` and Dockerfile. The web container serves compiled Solid assets through Nginx and proxies `/api`. Fonts have one-year immutable caching; API responses are not cached.

`docker compose down` preserves data. `docker compose down -v` removes the database volume.

## Local development with live updates

Requires Node 22.12 or newer.

```sh
npm install
npm --prefix api install
docker compose up -d mongo
docker compose stop web api
```

In two terminals:

```sh
MONGODB_URI=mongodb://127.0.0.1:27017/agentzuno npm run dev:api
npm run dev
```

Vite updates the frontend on save and proxies `/api` to port 3001. Node watch restarts the API after server edits. Set `API_URL` to change the proxy target. Set `MONGODB_DATABASE` to override the database name. Browsing public fixtures works without MongoDB; registration and saving require it.

## Accounts and workspaces

The Get access landing CTA always opens `/register`. Sign-in uses `/login`; registration has a dedicated `/register` page titled Register. Password guidance appears only on validation failure. Registration creates a salted scrypt password hash, a persistent account and workspace ID, and a session. Personal URLs use `/workspace/:workspaceId/...`. Open workspace opens `/workspace` and requires sign-in.

All workspace screens and application data require authentication. The landing page, login/registration, and identity sign-in callbacks remain public. Demo logins, existing demo sessions, anonymous workspace browsing, `/api/explore`, and the demo-account listing are disabled. Source fixtures remain development/test inputs and are not public workspace records. New registered accounts start with an empty personal workspace and a General knowledge base.

Sessions use random HTTP-only SameSite=Lax cookies. MongoDB stores hashes of session tokens with expiration; sessions last eight hours and survive API restarts. Set `COOKIE_SECURE=true` behind HTTPS. Email verification and password recovery are not implemented. Help desk workspace membership and identity provisioning are described below and remain separate from source knowledge permissions.

## Content

The plus menu offers Ticket and Chat, Admin-only Workflow design, and personal Admin knowledge creation (knowledge base, article, file). Source connections are managed through their dedicated pages. Saved content uses MongoDB.

Articles use Title and Body with free Tiptap core, StarterKit, and Image extensions. The toolbar supports formatting, headings, lists, quotes, undo/redo, and image upload. Images can also be pasted or dropped. Saved articles have an Edit action using the same form. The API sanitizes saved HTML and checks ownership on create/update and image references.

Images are limited to 5 MB and 20 megapixels, converted to WebP, and stored as MongoDB binary data. GIFs use the first frame. File uploads are limited to 5 MB and served as attachments. Unused uploads remain in the local database; automatic cleanup is not implemented.

Connections offers ServiceNow as the only built-in source, with Custom available as a title action. Custom accepts normalized JSON exports as private, AgentZuno-managed snapshots, without live sync or source ACL synchronization. Messaging and unimplemented apps are hidden from the public catalog; existing saved connections and legacy export imports remain supported. Compact cards open details with authentication and permission capabilities.

## Workspace UI

The 45px icon sidebar contains Create, Search, a separator, navigation, and a profile popup with theme controls. Page headers use simple route titles. The dashboard greets all users using local time, shows summary cards, and lists sortable Recent Activity across articles, files, and images. The prompt searches articles; it does not generate AI responses.

Search opens an overlay without changing the URL. Only the results region scrolls, its scrollbar is hidden, and a bottom fade indicates more results. Background scrolling is locked. The sidebar stays outside overlays and remains interactive; sidebar actions dismiss the open overlay. The workspace defaults to dark mode and stores the selected theme on the device.

## Structure

```text
src/pages/                 Route screens
src/layouts/               App and workspace shells
src/components/            Shared Solid UI and Tiptap editor
src/context/               Session and workspace state
src/services/              API, workspace URLs, overlay handling
api/src/                Express, authentication, MongoDB stores
api/mock-data/          Public examples, app catalog, demo fixtures
api/test/               API and database integration checks
docker/nginx.conf          SPA serving, API proxy, font caching
.vscode/                   Prettier settings and recommendation
AGENTS.md                  Stack, structure, naming, readability rules
```

Initial examples are JSON served through Express. Created records are stored in MongoDB. The frontend never imports private fixtures.

## API

- `GET /api/site`, `/api/explore`, `/api/integration-catalog`: public content.
- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`: accounts and sessions.
- `GET /api/auth/session`: current user or null.
- `GET /api/workspaces/:id`: authenticated workspace with ownership check.
- `GET /api/workspace`, `/api/me/workspace`: current account's workspace; the first also supports public guests.
- `GET /api/knowledge-bases`, `/api/articles`, `/api/files`, `/api/images`, `/api/integrations`, `/api/tasks`: current workspace collections.
- `GET /api/articles/:id`, `POST /api/articles`, `PATCH /api/articles/:id`: read, create, update articles.
- `POST /api/records/:type`: save `knowledge-base`, `file`, `connection`, or `connection`.
- `POST /api/uploads/images`, `/api/uploads/files`: upload image or file binaries.
- `GET /api/uploads/images/:id`, `/api/uploads/files/:id`: owner-only downloads.

Scoped frontend requests include `X-Workspace-Id`; the API checks it against the session. Authorization always comes from the session rather than the URL or request body.

## Checks

```sh
npm run format
npm run format:check
npm test
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm --prefix api test
```

Database tests create and remove a separate temporary test database. They cover registration, duplicate accounts, workspace ownership, record creation, article updates, image/file access, sanitization, and persistence after restart. VS Code uses Prettier on save, two-space indentation, LF endings, and final newlines.

The neural landing background references [Code Aims' NeuralPulse article](https://codeaims.com/blogs/interactive-neural-network-visualization-javascript), using an original CSS-animated SVG network.

## Connections, ingestion, and access policies

Every catalog app has a description and potential import data. Direct adapters are implemented for **Zendesk**, **Confluence Cloud**, and **Notion**, plus **ServiceNow** through an administrator-installed permission bridge. These require user-supplied provider credentials and have not been validated against your live accounts. Other apps do not silently claim live connectivity: legacy catalog sources and Custom support an owner-supplied normalized JSON export through an explicitly accepted AgentZuno-managed import.

Direct imports paginate source content, record source IDs/URLs, stage documents under a sync generation, and publish only complete generations. Missing documents are tombstoned after a successful full sync. MongoDB stores sync state and leases; the BullMQ dispatcher schedules due connections every 30 seconds, with a five-minute resync interval and a 5,000-document cap per connection. Failures retain the last complete generation and report Needs attention. Notion reads nested blocks within bounded depth/size limits. Provider rate limiting and timeouts fail closed; automatic OAuth refresh and webhook ingestion are not implemented.

Permission modes:

- **Source enforced**: supported for delegated Zendesk, Confluence, and ServiceNow bridge identities. Each result/document is fetched again under the connected principal before text or metadata is returned. Source denial, deletion, timeout, or failed verification withholds it. Source tokens must belong to the requesting account's connected identity. Shared broad administrator credentials must not be treated as end-user grants.
- **AgentZuno managed**: explicit copy authorization is required. The imported snapshot is private to its owner and governed by AgentZuno agent/knowledge-base grants. This is independent authorization for a copy; it does not reproduce host permissions or automatically revoke access after a host permission change. Notion's integration-token API does not establish effective end-user ACLs here, so it supports managed imports only.

Both modes remain owner-only across workspaces. Group-based sharing, workspace invitations/memberships, SCIM, and cross-user delegated source identities are not implemented. Never silently switch a source-enforced connection to managed mode.

Source credentials and enterprise client secrets are AES-256-GCM encrypted using `CREDENTIAL_ENCRYPTION_KEY` (32 random bytes encoded as base64). Docker reads it from the ignored `.env` file. Preserve this key with your database backups; replacing it prevents decryption of existing credentials. Standalone API runs must load the same environment variable. `.env.example` documents the configuration.

Normalized export format (JSON array, at most 1,000 documents and 4 MB in the UI):

```json
[
  {
    "id": "source-article-id",
    "title": "Article title",
    "text": "Article content",
    "url": "https://source.example/article"
  }
]
```

`POST /api/connections/import` accepts the array plus `provider`, `knowledgeBaseId`, and `acceptManagedAccess: true`. Snapshot imports do not poll their source. Disconnect immediately excludes a connection's documents and removes its stored credential. Public demo accounts cannot configure live sources, enterprise identity, or external-agent tokens; use a registered account.

## Enterprise identity providers

Settings supports Microsoft Entra ID, Okta, Google Workspace, OneLogin, Ping Identity, Auth0, Keycloak, and custom OIDC issuers. Register an OIDC client at your provider, configure its issuer/client ID/client secret, and register the callback shown in Settings. Enable it and link the enterprise identity while already signed in as the workspace owner. The workspace-specific `/login?workspace=WORKSPACE_ID` page then offers enterprise login.

The OIDC authorization-code flow uses PKCE, state, nonce, browser binding, expiry, and ID-token validation through `openid-client`. Linking uses the verified issuer/subject pair; email equality never links accounts automatically. This initial flow signs in an already linked owner and does not provision organization members or sync directory groups. Local password login remains available.

Known public provider origins are allowed. Custom hosted issuers such as Keycloak must be added to the API's `OIDC_ALLOWED_ORIGINS` allowlist. Discovery/token/JWKS requests require HTTPS, reject redirects and private network addresses, and have timeouts. Set `APP_ORIGIN` to the externally reachable web origin and use `COOKIE_SECURE=true` with HTTPS. Enterprise authentication establishes identity; it does not bypass knowledge/source/agent authorization.

Additional endpoints:

- `GET /api/identity-providers`; `GET/POST /api/settings/identity`
- `GET /api/auth/oidc/provider`, `/api/auth/oidc/start`, `/api/auth/oidc/callback`
- `GET/POST /api/connections`; `POST /api/connections/:id/sync`, `/:id/disconnect`
- `POST /api/knowledge/browser-search`; `GET /api/knowledge/documents/:id`

### Connection authentication

All select fields use the shared keyboard-accessible custom dropdown. A single available permission mode defaults automatically and is read-only. Managed imports no longer require a separate checkbox: the explicitly labeled import/connect action records the owner’s managed-mode selection. Copies remain private and do not track host ACL changes.

Notion accepts OAuth or an internal integration API key; Zendesk accepts delegated OAuth or email plus an API token (HTTP Basic encoding); Confluence accepts delegated OAuth or email plus an API token using a validated Atlassian subdomain. Password-based Zendesk authentication is deliberately excluded because the provider deprecated it. API-key/basic-token connections are limited to managed permissions.

Historical source OAuth reads saved encrypted application configuration. New built-in knowledge-source setup is retired; environment client credentials are no longer used.

Live OAuth handshakes require configured provider applications and have not been validated with production credentials. These provider flows currently use confidential-client code exchange plus browser-bound state; they do not implement PKCE or automatic token refresh. Expired/revoked source tokens fail closed and require reauthorization. Zendesk browser authorization and the other catalog adapters remain unimplemented; Zendesk can use an existing delegated OAuth token. Enterprise login OIDC is separate from source authorization.

### Durable workers and Chat

The Express project is now `api/`. Run `docker compose up --build -d` for MongoDB, Redis, API, web, and the separate BullMQ worker. Redis persists jobs with AOF on the `redis-data` volume; it is bound to localhost for local development. For local processes, set `MONGODB_URI`, `REDIS_URL`, and `CREDENTIAL_ENCRYPTION_KEY`, then run `npm run dev:api` and `npm --prefix api run worker` separately. The API no longer runs the sync polling loop.

BullMQ schedules a dispatcher every 30 seconds. It queues up to 100 due imports, deduplicates scheduled jobs, limits concurrent imports, serializes each provider with a renewable Redis lease, and uses MongoDB leases to protect individual snapshots. Imports retry five times with exponential backoff/jitter and honor provider Retry-After delays. Failed metadata remains for inspection, while connection status contains a safe error. MongoDB’s pending chat and due-connection records recover dispatch after Redis outages. Jobs are at-least-once, so publication remains lease/generation guarded. AOF every-second fsync can lose the latest second of Redis writes after a host crash; the MongoDB outbox supports redispatch. Incremental cursors and provider webhooks are still adapter-specific work, not implemented globally.

Chat is at `/workspace/:workspaceId/chat`, with individual threads at `/workspace/:workspaceId/chat/:id`. Guest submissions retain their draft in session storage for 30 minutes and resume after email/password login or registration. Registered users can configure encrypted OpenAI, Anthropic, or Google Gemini API keys under Settings, choose a default model, edit response instructions, set output limits, and control OpenAI reasoning effort. Current curated models come from [OpenAI](https://developers.openai.com/api/docs/guides/latest-model), [Anthropic](https://platform.claude.com/docs/en/models/overview), and [Google](https://ai.google.dev/gemini-api/docs/models); provider account availability can differ.

Chat messages persist in MongoDB, with queued/responding/complete/failed states and retry controls. Responses use safe plain-text rendering. The worker sends only the conversation and configured instructions to the chosen provider; workspace documents and credentials are not automatically added. Provider generation is bounded to 90 seconds and response bodies to 2 MB. Chat does not yet stream individual tokens or execute tools. Live responses require your own provider API key and billing/model access.

### Import destinations

Choose **Bundle into an existing knowledge base** or **Create knowledge bases with source names** on a connection or export import. Existing-base imports validate workspace ownership. Source-name imports use stable source IDs scoped to that connection, preserve names, and reuse the mapping on later syncs. Zendesk categories, Confluence spaces, and Notion root pages/databases provide group names. Normalized exports must include `"knowledgeBase":{"id":"source-base-id","name":"Source name"}` per document when preserving source bases. Newly created bases remain private and are never automatically added to agent grants.

### ServiceNow deployment-assisted adapter

ServiceNow now has a direct adapter for the authenticated knowledge permission bridge in [integrations/servicenow](integrations/servicenow/README.md). An administrator must install and validate the Scripted REST resources in your tenant. It imports published knowledge only, validates the bridge identity, and re-reads source-enforced articles under the delegated OAuth identity. ACLs and KB/article user criteria are evaluated inside ServiceNow; errors deny retrieval. Basic authentication is limited to managed copies. A real ServiceNow tenant has not been available for live validation. Most other catalog apps still support normalized exports only; the catalog-wide native adapter rollout is not complete.

Agent knowledge-base fields use the shared searchable multi-select lookup with removable pills. Agent creation defaults Enable connection on; no knowledge is granted until bases are selected. All current knowledge bases defaults off and makes the individual lookup read-only when enabled. The API resolves all current bases from the owner’s workspace and saves a snapshot, so newly created bases still require another explicit save. Single-select and multi-select menus close after selection; all scrollable areas use shared thin, rounded, theme-aware scrollbars, with Search retaining its hidden scrollbar.

### Knowledge dashboard and organization

Knowledge now has Overview, Bases, Articles, and Topics tabs. Overview uses lazily loaded D3 charts with 7/30/90-day periods, accessible exact-value tables, real article views, agent retrieval references, busiest agents, inventory states, base coverage, empty/stale content counts, and source health. Usage events and query audits are owner/workspace-scoped; public/demo inventory does not invent usage history. References mean articles returned by permitted searches, not confirmed downstream AI citations. Imported titles are permission-checked before analytics displays them. Inventory counts include stored snapshots and do not independently prove current source access.

Authored articles belong to one knowledge base and can have multiple topics. The editor uses a searchable single-reference base lookup and pill-based topic lookup. Topics have their own creation page and do not change permissions. The API rejects foreign bases/topics and retains existing associations when legacy clients omit these fields.

The registry adds managed-copy native adapters for Document360 v3, Freshdesk solutions, Help Scout Docs, Intercom articles, and Helpjuice articles. They validate their provider-specific settings, import published knowledge, preserve source grouping where available, and use bounded pagination and fixed HTTPS endpoints. These adapters have fixture-based validation and still need live credential testing in your tenants; they do not claim end-user ACL synchronization. The remaining catalog apps are still export-only until their native adapters are implemented.

### Custom API imports

Custom accepts a JSON file or scans a public HTTPS API endpoint using no authentication, a bearer token, an API-key header, or basic authentication. GET responses must be a normalized document array or `{ "documents": [...], "next": "/next-page" }`. Each document uses the same `id`, `title`, `text`, optional `url`, and optional source `knowledgeBase` schema as file imports. Choose an existing base or preserve source base names.

Endpoint scans create private AgentZuno-managed snapshots; they do not infer source ACLs or run scheduled synchronization. Credentials are used only during the request and are not stored. The API blocks private/reserved addresses, pins validated DNS addresses, verifies TLS, refuses redirects and cross-origin pagination, and limits requests to HTTPS port 443, 12 seconds per page, 20 pages, 4 MB total, and 1,000 documents. Arbitrary response-field mapping, crawling linked websites, and custom OAuth handshakes are not supported.

Workspace routes share accessible breadcrumbs for sections, knowledge tabs and filters, records, creation, and article editing. Article trails include their owning base; parent links stay scoped to the current workspace. Articles store one base ID, and the API rejects arrays, plural base assignments, null, and foreign base references. Topics remain multiple and do not grant permissions.

Authored articles default to Draft and support Review and Published using the status button in the full-height collapsible right details panel. On a saved article, status updates persist immediately; in the editor they apply with Save. The panel includes metadata and relevant actions and remembers its collapsed state. Status is editorial metadata, not an access grant or a public publishing action. Imported source articles remain read-only.

Connections uses the article reading width and a single alphabetical stacked list. Add Custom connections from the title action. Badges reflect saved connection and sync state; imported JSON/API snapshots are labeled separately from live active adapters.

All forms share custom inline validation and an accessible linked error summary. Validation runs on blur and submit, rechecks corrected fields, and focuses the first invalid control. It covers input constraints, files, selection controls, and article body content; OAuth entry uses the same checks without requiring a manually entered token. Server validation and authorization remain mandatory. Recent Activity displays type icons with visible type names.

Icons use locally hosted Google Material Icons Outlined through the shared component. Article actions appear first in the collapsible details panel.

## Current ServiceNow and vector search setup

See [the complete setup guide](docs/servicenow-setup.md) for bridge installation, delegated source permissions, MongoDB/Qdrant/Ollama indexing, Docker startup, multiple agent clients, editable records, and limits. The public catalog now offers ServiceNow only; Custom snapshots remain available. Legacy adapters are retained internally for old records. Token-level base permissions have been removed; tokens follow the agent’s current permissions on each request.

## Conversational employee help desk (backend preview)

Zuno's new product direction is a conversational AI help desk for employee requests across IT, HR, Legal, Finance, Facilities, and general support. The landing page uses the requested positioning; **Slack, Microsoft Teams, email delivery, organization-wide access, and one-day deployment are targets, not implemented or validated guarantees**. No project-wide open-source license has been selected yet; dependency licenses do not license this application.

The help desk backend supports registered accounts with workspace-scoped Admin, Agent, and User roles. MongoDB persists requests, conversations, routing settings, approval records, and an actor/timestamp event history. The requester is derived from the authenticated session. Client-supplied identities, channels, and ownership fields are rejected. Existing source knowledge and agent access rules are unchanged. There are no public help desk webhooks or employee impersonation endpoints.

API endpoints (session cookie required; use `X-Workspace-Id` for the current workspace):

- `GET /api/helpdesk/settings`: department choices, saved routes, and truthful channel readiness.
- `PUT /api/helpdesk/settings`: replace `routing` with entries such as `{ "department": "it", "queueName": "IT support" }`. Routes are labels, not membership grants or external queues.
- `POST /api/helpdesk/requests`: `{ "requestId": "<UUID>", "title": "VPN access", "text": "I cannot connect", "department": "it", "priority": "normal" }`. Repeated request IDs return the existing request within the same owner/workspace.
- `GET /api/helpdesk/requests`: newest 50 summaries; optional `status` and `department` filters.
- `GET /api/helpdesk/requests/:id`: conversation, approvals, version, and history.
- `PATCH /api/helpdesk/requests/:id`: `version` plus `status`, `department`, or `priority`. Statuses are `open`, `waiting-for-employee`, `waiting-for-approval`, `escalated`, and `resolved`; waiting for approval is entered by creating an approval. Resolve/reopen and escalation are manual, not inferred from an AI response.
- `POST /api/helpdesk/requests/:id/messages`: `{ "version": 1, "text": "Please provide the error message." }`. Replies stay inside the help desk workspace; they are not delivered externally.
- `POST /api/helpdesk/requests/:id/approvals`: `version`, `action` (`access-request`, `software-request`, or `policy-exception`), and `reason`.
- `POST /api/helpdesk/requests/:id/approval-decisions`: `version`, `approvalId`, and `decision` (`approved` or `rejected`). Decisions require an Admin or Agent with explicitly assigned `canApprove` permission; the role alone does not authorize approval. These are tracking records, not verified external manager approvals. Approval never executes an action or grants access.
- `POST /api/helpdesk/requests/:id/drafts`: `{ "requestId": "<UUID>" }` explicitly submits a bounded excerpt of this request to the help desk workspace owner's configured AI provider. Returns a queued chat; poll `GET /api/helpdesk/requests/:id/drafts/:chatId` for its response. Drafts remain accessible only to their creator while their current role and queue permissions allow access to the request. Drafting uses the existing durable BullMQ/MongoDB chat path, remains review-only, and does not send knowledge bases or source credentials to the model. No configured provider produces a visible failed response rather than a fabricated answer.

Mutations require the current integer `version` to avoid overwriting concurrent changes (409 means reload). Conversations and history are bounded. The Tickets UI supports employee and operator conversations. External automation execution and automatic publication of AI replies are not implemented. Help desk request sharing is role-scoped; existing knowledge, files, credentials, OIDC, and connected-agent grants retain their separate owner/source policies.

Before enabling real channels, extend the help desk membership model with invitations and enterprise lifecycle provisioning, verified source identities, signed/replay-protected channel ingress, tenant/channel binding, durable inbound/outbound delivery with idempotency, provider-specific authentication and retries, and approval-scoped action executors. Channel membership alone must never grant HR, finance, or internal knowledge access. Public/unknown identities must fail closed. Do not reuse knowledge-source credentials or agent bearer tokens as channel credentials.

Verify with `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm --prefix api test`, `npm run build`, and `npm run format:check`. Rebuild/restart `api`, `worker`, and `web` after changes.

The product reference is [Flow by ServiceNow](https://www.letsflow.ai/): conversational requests in existing channels, connected knowledge/tools, administrator-defined automation limits, and human handoff. These inform the direction; Zuno currently implements only the owner-scoped backend preview described above, not Flow’s channel integrations, organizational identity, or automation execution.

### Conversational workflow configuration

Admins can describe a workflow using `POST /api/helpdesk/workflow-conversations` with `text` and a UUID `requestId`, then refine it through `POST /api/helpdesk/workflow-conversations/:chatId/messages` with `text` (or `retry: true` after a failed generation). Poll `GET /api/helpdesk/workflow-conversations/:chatId` for replies. Only the creating Admin may read or continue the conversation. A configured AI provider and running worker are required. Responses are proposals only and never save or enable configuration.

Explicitly review and save a workflow using `POST /api/helpdesk/workflows` with `name`, `department`, `keywords`, `action`, `queueName`, and `enabled`. List with `GET /api/helpdesk/workflows`; edit/disable with `PUT /api/helpdesk/workflows/:id` and the current `version` plus the complete definition. Supported actions are `route` and `handoff`; arbitrary code, tools, credential handling, and external provisioning are rejected. There are at most 50 workflows per owner. On request creation, enabled workflows match the selected department and any literal case-insensitive keyword in the initial title/message; the oldest matching workflow wins. The resulting queue, status, workflow ID, and version are saved on the request. Changing a workflow does not retroactively reroute existing requests. The Workflows page provides the conversational admin screen and visual/code views.

### Governance audit

When MongoDB is configured, non-public API requests are recorded in `governanceAudit` before execution, including anonymous denied requests, configuration changes, request reads, approvals, and workflow conversation submissions. Records contain actor/workspace, method, target path (without query strings), timestamps, outcome, and status; `X-Audit-Id` correlates the response. Message bodies, credentials, cookies, headers, and AI prompts are excluded. `GET /api/helpdesk/audit` returns the selected help desk workspace’s newest 100 audit entries to Admins only. Public catalog/site reads and session checks are excluded. No API allows editing/deleting audit entries.

Audit storage failure blocks the action before execution. If completion logging fails after a mutation, the API returns 503 with the audit ID; check current state before retrying because database changes and audit outcomes are not a single transaction. Started/interrupted records can represent interrupted operations. Existing per-request history records business transitions and approvals. AI worker response processing also records start/completion/failure audit entries without storing prompts or model output. These records are not tamper-proof against database administrators; centralized export, retention policy, immutable storage, dedicated read-only auditor permissions, and full historical coverage of pre-existing source workers remain future work. The preview does not certify compliance.

The landing neural web keeps its dense static SVG connections in one path and limits animated motion to 12 signal paths and 12 pulses on a separate overlay. Glow filters and per-neuron animations are avoided to reduce repaint work. Pause and reduced-motion controls remain supported; button hover uses a short background-color transition.

## Help desk roles and workspace membership

Role values are `admin`, `agent`, and `user`; display names are **Admin**, **Agent**, and **User**. “AI agent” remains separate from the human Agent role and from external-agent bearer tokens. Registration creates an Admin for that account's own workspace. Existing workspace owners remain Admins without changing their credentials or source permissions. Joining another help desk does not change the account’s personal workspace or grant access to that organization's knowledge bases, files, AI keys, OIDC configuration, or external-agent tokens.

| Capability                                                    | Admin                           | Agent                                               | User         |
| ------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- | ------------ |
| Submit requests                                               | Yes                             | Yes                                                 | Yes          |
| Read/reply to requests                                        | All workspace requests          | Assigned queues                                     | Own requests |
| Update status, priority, or routing                           | All workspace requests          | Assigned queues; destinations must also be assigned | No           |
| Request an approval / draft an AI reply                       | Yes                             | Assigned queues                                     | No           |
| Approve/reject                                                | Only with explicit `canApprove` | Only with explicit `canApprove`, in assigned queues | No           |
| Manage members, routing, workflows, or workflow conversations | Yes                             | No                                                  | No           |
| Read workspace governance audit                               | Yes                             | No                                                  | No           |

Approval authority defaults off, including for Admins. It records governance decisions only, never provisioning access or executing external actions. Queue grants match exact queue names; a queue deliberately shared across departments grants access to those departments' requests in that queue. An Agent with no queues retains requester access to their own requests but cannot handle other employees’ requests. Agents replying outside their assigned queues act only as the requester and cannot change status or draft AI replies there. Admins can route anywhere; Agents cannot route into unassigned queues. All role and queue checks happen on the server. Users cannot change role, requester, channel, owner, or workspace through request payloads.

Use `X-Workspace-Id` to select an authorized help desk workspace on `/api/helpdesk/*` endpoints. Without the header the account's personal workspace is selected. Other API namespaces continue to enforce personal ownership and reject a foreign workspace header. Membership is loaded on every help desk request, so disablement, demotion, approval changes, and queue changes affect existing sessions immediately. AI drafts and workflow setup use the selected workspace owner's configured provider; they never reveal its key. The worker rechecks current membership and request access before generation and before publishing a result. AI conversations remain private to their creator and cannot be reused across different purposes or requests via an idempotency ID.

Membership API (the Users screen provides member management; email invitations are not implemented):

- `GET /api/helpdesk/access`: effective role, queues, workspace, and approval permission.
- `GET /api/helpdesk/workspaces`: personal workspace and up to 100 active help desk memberships.
- `GET /api/helpdesk/members`: Admin-only member list with current versions.
- `POST /api/helpdesk/members`: Admin adds an existing registered account using `email`, `role`, `queues`, `active`, and `canApprove`. No invitation email is sent. At most 200 membership records per workspace.
- `PUT /api/helpdesk/members/:userId`: Admin edits `role`, `queues`, `active`, `canApprove`, and current `version`. Identity cannot be changed. Set `active:false` to revoke help desk access. Stale versions return 409. Users cannot receive approval permission, and queue assignments apply only to Agents.

The original owner must remain an active Admin, preventing loss of the last administrative account. Another Admin must edit a non-owner Admin's own membership. Owners can explicitly enable their own approval permission through their membership edit. Membership changes record actor, target, role, queue grants, approval permission, version, and time in governance history; account passwords and conversation text are excluded. Role changes are not a substitute for source-level permission checks. Workspace ownership transfer, SCIM/group synchronization, and enterprise member login provisioning are not implemented.

## Help desk navigation and setup

Browser writes accept localhost and 127.0.0.1 interchangeably only on the configured APP_ORIGIN protocol/port; other origins remain blocked.

All workspace pages now require sign-in; the landing page stays public. **Get access** always opens `/register`. The second CTA opens the authenticated workspace. Demo accounts and anonymous workspace browsing are disabled, including old demo sessions.

The sidebar includes **Tickets** for all authenticated members, and **Workflows** and **Connectors** for Admins. The profile dropup includes **Users** for Admins. Its workspace picker lets members switch to their authorized help desks; links preserve the selected workspace. Personal knowledge/source settings remain separate from organizational ticket access.

Tickets includes an access-filtered list, creation, conversations, status/priority controls for authorized operators, and explicit approval decisions for designated approvers. Users includes member creation/editing, roles, queue assignments, active state, approval permission, and directory users awaiting sign-in. Settings uses keyboard-accessible native accordion sections, all collapsed when the page opens. Saved AI providers are listed with model, enabled/default status, and key-presence metadata; a blank key preserves the encrypted saved key. Saving keeps the form mounted and refreshes persisted settings without erasing its confirmation. Turning off default removes only that provider's default preference.

### Automatic employee provisioning

When an identity provider is enabled, Add User is hidden and the API rejects manual membership creation. Authorized Admins can still edit existing memberships. Disabling the provider restores manual creation; SSO and SCIM provisioning use their own validated paths.

Saving an identity provider enables an explicit **Automatically add employees on SSO sign-in** preference (new configurations default on). After validated OIDC sign-in, Zuno can create an enterprise-only account and User-role help desk membership. Identity is bound to issuer and subject. Existing email/password accounts are never silently linked by email. Provisioning gives no source knowledge grants, queue grants, approval authority, or Admin role. Existing owner-linked SSO remains supported. Enterprise-only accounts cannot use password login.

For import before first login, configure the identity provider's SCIM provisioning application using the URL and token in Users → Identity provisioning. OIDC itself does not expose a user directory or automatically enable directory API permissions. Tokens are workspace/provider-version bound, stored as hashes, expire after 30 days, and are invalidated by rotation or identity configuration changes. The workspace owner configures provisioning; other Admins can inspect its status. Supported SCIM v2 operations are ServiceProviderConfig; paginated Users list with optional exact userName/externalId filter; create, read, replace, limited PATCH (active/userName/displayName), and soft-delete/deactivation. Groups, roles, bulk operations, password provisioning, sorting, and enterprise provider certification are not implemented.

SCIM creates a directory entry. The first verified SSO login creates its account and membership. Supply a stable externalId matching the OIDC subject; otherwise a verified email can locate an unbound directory entry, which is then permanently bound to that subject. A different subject cannot reuse it. Disabling a bound directory user disables help desk membership, including existing sessions. SCIM roles and group grants are rejected; Admins manage roles in Zuno. Provisioning integration needs live validation against your identity provider before production rollout.

### Slack, Teams, Gmail, and Outlook connectors

Connectors offers OAuth authorization for **Gmail**, **Microsoft Teams**, **Outlook**, and **Slack**, alphabetically. Click a connector and save its Client ID and Client Secret in the dedicated form; Slack also needs its Signing Secret. Register the displayed OAuth callback with the provider. Secrets are encrypted server-side, scoped to the workspace, and never returned to the browser. Saving application details invalidates old OAuth states and disconnects the connector until authorization is repeated; no service restart is needed. Environment variables remain optional deployment defaults. Use a public HTTPS application origin and secure cookies for deployment.

Authorization state is short-lived, single-use, actor/workspace/browser bound. Non-Slack flows use PKCE; Slack uses its confidential-client exchange and browser-bound state. Token exchanges and identity checks use fixed HTTPS hosts, reject redirects, and bound time and bytes. Provider tokens are encrypted, never sent to the frontend, and removed on disconnect. Callback membership is checked again before saving. Slack requests history/users access and Teams requests User.Read/Chat.Read. Gmail support inboxes request gmail.readonly and gmail.send. Outlook requests offline_access, User.Read, Mail.Read, and Mail.Send. Provider applications and consent may require administrator or vendor verification.

**Authorization and activation are separate.** Gmail and Outlook connect a dedicated support mailbox. Admins explicitly enable inbox processing and optionally automatic replies; without automatic replies, generated responses remain on tickets for review. Old read-only connections require reauthorization. The worker checks new messages about every minute, refreshes expiring email tokens, creates/continues sender-scoped tickets and Zuno conversations, applies enabled routing/handoff flows, and replies in the provider thread. Email senders never become authenticated workspace users and receive no knowledge grants. No workspace knowledge is automatically sent to the model.

Polling is bounded to 25 messages per pass; larger backlogs stop with a visible connector error rather than silently skipping mail. Only inline plain text is ingested; HTML-only messages, attachments, automated/list mail, self-mail, and mismatched Reply-To addresses are skipped. This first version does not ingest shared/delegated mailboxes, notification webhooks, attachments, or historical mail. Reauthorize by signing in as the dedicated support mailbox. Sending is claimed durably before the provider call: failures with ambiguous delivery are held for review and never automatically resent. This favors duplicate prevention over automatic recovery; it is not exactly-once delivery. Provider consent and delivery still require live validation with your applications; automated tests use fixtures.

Slack Events ingress and private bot replies are implemented as described below; Teams bot installation/activity validation, messaging-token refresh and Teams delivery remain unimplemented. Their UI distinguishes OAuth authorization from active delivery.

### Conversational executable workflows and SDK

Admins create workflows conversationally or edit TypeScript directly. The builder provides a high-level visual outline, forms, permissions, executable code, simulated tests, durable runs, SDK documentation and conversation history. Completed proposals update the source and visual metadata; partial code is hidden from chat. Valid edits autosave drafts; explicit publishing activates an immutable source/revision snapshot. The worker executes its `run(ctx)` function only after request submission.

See [the executable SDK and runtime limits](api/sdk/workflows/README.md). Docker Compose bundles the TypeScript compiler and QuickJS WebAssembly sandbox in the existing worker. No Docker socket, runtime download or extra runner service is required. Conversational generation requires an AI provider; code editing and simulated tests do not. Supported actions are existing-queue routing/handoff, designated-user approvals and Slack messages through a configured OAuth installation. The bot must belong to the declared Slack channel. ServiceNow/Jira execution is unavailable.

MongoDB stores frozen inputs, published source hashes/revisions, leases and completed step receipts; BullMQ carries only scoped IDs. Replay skips completed effects. Approval waits release compute until the designated active approver decides. Uncertain Slack delivery stops for investigation and is never automatically resent. The sandbox has no direct filesystem, network, credentials, clock, randomness or arbitrary module loading. CPU, memory, source, step and wall limits apply. This is a WebAssembly/worker-thread boundary, not a separate operating-system container or a security certification.

An operator can intentionally clear old workflow data with `docker compose exec -T api node scripts/reset-workflows.mjs --confirm`. This destructive script is restricted to the explicitly authorized local app databases and clears workflows, workflow conversations/chats and runs. It preserves accounts, knowledge, requests, connectors, organizational data and audit history, and never runs automatically on startup.

### Built-in assistants, Inbox, and simplified navigation

The **Admin agent** designs workflows and proposes configuration for authenticated Admins; valid drafts autosave after edits; publication is explicit. **Zuno** handles requester support conversations and enabled server-authorized routing/handoff flows. Their identities and capabilities are selected on the server. Only reviewed, published workflow code executes through the bounded runtime; neither assistant receives unrestricted credentials or configuration tools. External Connected agents, agent registration/token APIs, and MCP/REST endpoints have been removed; historical records are retained but are not served.

Admins and Agents land on **Inbox**, replacing Dashboard/Recent Activity with accessible support tickets. Users land on **Chat**, with Chat, Tickets, and Knowledge navigation only. Knowledge membership does not grant access to owner-only sources; the User view currently shows an empty shared-knowledge state until an explicit sharing policy is implemented. Inbox, Tickets, Users, and directory users use the shared RecordTable. Add/edit users opens a focus-managed modal within the content area. Breadcrumbs are removed. Employees do not select departments in Chat or Tickets: matching enabled workflows select routes; unmatched requests use general support. Chat uses readiness-based Send activation without form validation messages; API bounds remain enforced.

Admins can use **Impersonate** in the profile dropup to impersonate Agent or User permissions within their current account. The server verifies the real Admin membership on every request and applies the selected lower role to request access and mutations. User mode opens Chat; Agent mode opens Inbox and uses the Admin's existing assigned queues (usually none). A visible Return to Admin control exits the mode. This is role impersonation, not another employee's identity or source credentials. Membership records remain unchanged; governance events retain the real actor, actual role, effective role, and impersonation flag. Preview state is tab/workspace scoped and is cleared automatically if Admin permission is revoked.

### Submitted tickets, comments, and work notes

Chat is a private conversation, not a ticket. Conversations appear in Chat history. Creating or continuing a chat never adds an Inbox/Tickets item or copies chat turns/model output into ticket comments. Use New ticket, or the explicit Submit ticket action in Chat: review the title/description and submit with Zuno. Submission is idempotent for that conversation and applies enabled routing workflows. Historical tickets created automatically by chat are excluded from ticket views; their conversation history is retained. Support inbox emails remain explicit incoming request submissions.

Ticket detail pages show a ticket number, description, requester, assigned queue, status, priority, channel, source, and timestamps. Authorized requesters can add public Comments. Admins and Agents assigned to the ticket queue can also add internal Work notes. An Agent's own ticket outside their queues grants requester access only. Work notes are removed from requester JSON responses, lists, mutation responses, and activity events on the server and are never included in AI draft context. Confirmed outbound email replies become public comments; unsent generated email drafts remain restricted to ticket operators. Work-note and comment saves use current versions and governance auditing.

The workflow builder no longer displays canned ServiceNow/Jira example options. SDK action support is unchanged.

Workspace navigation keeps the sidebar and shared shell mounted. Access loading is keyed to account, selected workspace, and impersonated role rather than each pathname, preventing route changes from blanking the entire layout. Background workspace refreshes keep existing content mounted. API authorization still runs on every request.

The New ticket form uses Title and Details without department or priority choices. Priority defaults to normal on the API and can be changed by an authorized operator on the ticket detail page.

After a requester submits a ticket, the processing screen starts an idempotent Zuno review and displays persisted worker progress. The review opens a private support conversation for troubleshooting; it does not automatically add comments, resolve the ticket, or execute external actions. Only the authenticated requester can start the review. A configured, enabled workspace AI provider is required; failed generation remains retryable in Chat and the submitted ticket remains available.

Both built-in assistants now retrieve relevant published, locally authored articles before generating a response, using bounded keyword lookup in MongoDB. Retrieval checks article ownership and rechecks publication/content before publishing output. Draft/Review articles, another owner's articles, and email sender identities do not receive this access. This authored-article path is keyword retrieval; imported source/vector authorization remains separate.

Workspace navigation starts with Chat, followed by Inbox for operators and My Requests. Chat is the default landing page for all roles; Inbox has its own `/workspace/:workspaceId/inbox` route. Request numbers use `REQ-` and legacy prefixes are normalized when displayed.

Admins can customize the workspace chat greeting in Settings → Chat (1–200 characters). The default is “How can I help you?”. All active workspace members receive the same greeting; other workspaces remain isolated.

Recent chat history loads 15 conversations at a time with scoped cursor pagination, automatic loading on scroll, and a keyboard-accessible Load more chats fallback. Request creation is labeled Request throughout the global plus modal, submission forms, and chat actions; existing ticket URLs are retained.

Chat supports private attachments: TXT, Markdown, CSV, JSON, and LOG files containing valid UTF-8 text, up to 100,000 bytes each and five per message. The paperclip adds files and each pending chip has a Remove button. Uploads persist binaries and extracted text in MongoDB; submitted files remain owner/workspace scoped and are referenced only by their conversation's AI context, with server authorization rechecked before output. Unsubmitted uploads expire after seven days. Daily uploads are bounded at 100; AI attachment context is bounded at 30 files and 100,000 characters per conversation. Attachments are not shared Knowledge articles or source-permission grants. PDF, Office documents, images, and OCR are not currently supported. File text is untrusted reference material and cannot authorize actions.

Every support and workflow assistant response retains an Activity dropdown, including completed and failed responses. Recorded stages show Processing, Completed, or Failed as the worker progresses. Dropdowns remain open across polling updates. Chat no longer has a standalone Complete footer or Submit request button; requests remain available from My Requests and the global create menu.

Assistant chat responses render Markdown with Marked and DOMPurify, using a strict formatting/link allowlist. Raw model HTML is escaped, scripts and unsafe links are removed, and remote images are not loaded. User messages remain plain text. Run `npm run test:ui` for Markdown formatting and injection tests.

Inbox has Subject and Updated columns with rounded, consistently structured panels for requests, email requests, and approvals. Primary and Archive are personal folders: archiving/restoring persists per authenticated user/workspace and never changes request status, queue access, or someone else's inbox. APIs revalidate access before either operation. Workspace page content shares a 1120px maximum width, with room reserved for fixed detail panels.

Workflows opens a saved-workflow list. New workflow opens `/workspace/:workspaceId/workflows/new`; selecting a workflow opens `/workspace/:workspaceId/workflows/:id/edit`. The builder keeps chat on the left and Visual/TypeScript/SDK tabs at the top of the right panel, with both panels filling the available viewport height on desktop. Saving a new workflow retains the conversation and updates its edit URL.

Inbox supports individual selection, Select All with a mixed state, and bulk Archive/Restore. Actions run in bounded batches and retain per-item API permission checks; partial failures are reported. Status badges use both text and color. Requests and articles start read-only; use Edit and explicit Save to persist metadata changes. Required fields validate on submission, and existing errors clear as corrected. Bases, Articles, and Topics use the Inbox-style panels.

Workspace portal domains are configured by Admins under Settings → Custom Domain. Set `CUSTOM_DOMAIN_TARGET` to your public application hostname and `COOKIE_SECURE=true` on the API. Add the displayed verification TXT record and a CNAME to that target, configure HTTPS/certificates for the custom hostname at your hosting provider or reverse proxy, verify DNS, then enable the portal. The bundled Nginx forwards Host to the API; your public edge must preserve the original Host. TLS certificates and public DNS are not provisioned automatically. Only public subdomains are supported. DNS ownership and CNAME routing are rechecked at most every 60 seconds during portal requests and fail closed. Domains are unique and bound to one workspace; browser origins must match the verified portal host, and membership remains mandatory. Registration does not grant organization membership. Start identity and integration OAuth setup on the canonical application hostname; custom-host OAuth callbacks are not implemented. Disable/remove the domain from the canonical app if DNS is broken.

Request-review instructions remain server-side, separate from visible user messages. Existing generated review prompts are removed from their displayed history and titles. Zuno uses practical questions and verified guidance without unsolicited missing-knowledge disclaimers; recommended app destinations use workspace-scoped Markdown links.

### Workflow request forms and application styling

The workflow builder includes a **Form** tab for conversational field generation, manual field editing, and employee-form previews. Definitions support up to 20 fields (short text, long text, choice, and yes/no), required answers, and optional accessories. The TypeScript SDK validates these definitions and answer values. Only enabled, matching routing/handoff workflows offer forms in authenticated support conversations. Submission validates the current revision and stores a snapshot of field labels and answers on the request; drafts, disabled workflows, stale versions, and another employee’s chats cannot be submitted. Requests keep their existing role/queue permissions. Submission schedules the published TypeScript runtime; only declared, supported, authorized actions can execute. Form generation requires a configured AI provider; manual editing and previews work without one.

Application and authentication screens use locally hosted Inter; the public landing page retains Shippori Mincho. Lists and fields use shared spacing and alignment. Inbox archive actions appear contextually with selection. Article pages show linked knowledge-base/topic breadcrumbs; read-time estimates are removed.

Inbox, My Requests, Knowledge lists, Users, Workflows, Connectors and source Connections share the sortable table component. Headers expose the current direction; Inbox/My Requests default to Updated descending. Connector rows open dedicated configuration pages with consistent Not Configured states. Knowledge Sources and ServiceNow are removed from connector setup navigation. Workflow editing fills the content viewport, with compact breadcrumbs and right-aligned Publish/Unpublish controls and edit-triggered draft autosave. Support chat uses unboxed assistant responses, user bubbles, and composer focus on entry. Admin Chat settings include the support agent name and bundled icon, scoped to the workspace.

### Admin data and workforce profiles

The Admin **Data** section stores typed reference and mapping tables. Create table schemas manually or converse with the Admin agent, review the proposed fields, then explicitly save. Types include text, email, numbers, dates, yes/no and references to users or existing tables. Create and edit records in the shared table UI. Schema edits preserve existing record compatibility. Built-in Departments, Locations, Organizations, Divisions and Cost Centers use the same records as profile lookups. Custom tables are limited to 100 per workspace, 20 fields per table and 10,000 records per custom table. Data and schema APIs are Admin-only, ownership-scoped and audited; chat requires a configured model provider. Table records are not automatically shared with support agents or sent to providers. Record import/export, custom unique constraints, automatic table execution and general employee data permissions are not implemented.

Profiles include workforce names, title, employee ID/type, work/mobile phones, address, locale and time zone. Organizational fields reference shared records; managers reference workspace members. Admins can edit locally managed profiles. SCIM imports support bounded core name/title/locale/timezone/work-phone/address values and enterprise department, division, organization, cost center, employee number and manager references. Provider-owned profiles remain read-only in the app; manager names resolve after directory identity binding. OIDC sign-in imports verified standard name/locale/time-zone claims. Arbitrary Okta custom claims are not automatically mapped, and profile values never assign roles, queues or source permissions.

All shared list queries apply search, sort and pagination on the server after authorization (25 records per page by default). Inbox archive actions require a confirmation dialog. Conversational form submission cannot create a duplicate request and replaces the form with its request link. Valid workflow drafts autosave independently of the published configuration. Publish/Publish Changes activates a reviewed source revision; Unpublish disables it. Published TypeScript can execute only the supported, authorized gateway actions. The History tab reopens persistent Admin workflow conversations without overwriting a draft merely by viewing an older conversation.

Workflow forms support conditional routing in the Form tab or through the Admin agent. Add ordered rules using All/Any conditions and Equals/Does Not Equal comparisons against form fields; the first match selects a queue and Route/Handoff action, with the workflow's existing step as the default. Rules use exact typed comparisons and are validated server-side. Draft edits do not affect published routing until Publish Changes. Submitted requests retain the published revision, matched rule, destination and answers for governance. Conditional routing runs on explicit form submission, not while an employee types answers.

Built-in Data tables (Departments, Locations, Organizations, Divisions and Cost Centers) include organization fields for codes, leadership, hierarchy, contacts, addresses and budgeting. Admins can use Edit Fields to customize labels, optional fields and typed custom fields, manually or conversationally, then Save Table. Definitions and values persist per workspace; existing workforce/profile reference IDs remain unchanged. Name and Description retain their shared field IDs, types and requirements. Fields containing saved values cannot be removed or change type/reference target until those values are cleared; required fields must be filled on existing records first. Schema and record edits use version checks, workspace authorization and the existing audit log. Identity provisioning preserves existing custom values and can create references with organizational fields left blank for Admin completion. Custom Data fields do not change source permissions or grant support-agent access.

Users includes Users and Queues tabs with server-side search and sorting. Admins create queues, edit their description and natural-language routing guidance, and assign active Agents through the shared reference picker. Queue membership updates the same queue grants used by request authorization; stable queue names preserve existing assignments. Guidance is saved for administration; it does not automatically execute routing—published workflows determine request routing. Queue edits require current versions and are audited. The Users page shows provisioning controls only when provisioning is enabled, without the setup banner.

Request details show the associated workflow and submitted revision. Admins can open it directly; other participants see only its published name. Rename a workflow in the builder's top bar: valid changes autosave to the draft, while Publish Changes updates the published name. Existing request associations keep the workflow ID and original submitted revision.

Data field editing uses the full-height workflow-style builder: Admin conversation on the left and Fields, Preview and JSON Definition tabs on the right, with explicit Save Table in the top bar. Add/Edit Record opens a dedicated page rather than a modal. Manager/head/owner fields reference workspace users by stable user IDs; lookups show names with emails to distinguish people. Queue assignments reference active Agents. Schema changes never convert user references to free text automatically.

Workflow discovery recognizes whole trigger phrases and, when offering a form, a clear request for a configured choice (for example, “request a Mac” can discover a Laptop Order form whose Platform choices include Mac). Explicit triggers take precedence; ambiguous choice matches offer no arbitrary form. This is bounded text matching, not general semantic understanding. Add alternate employee phrases such as MacBook and new computer to a workflow's trigger phrases through the Admin agent, then Publish Changes. Matching a form never submits a request or runs external actions.

Slack now supports a bot installation with signed Events API intake, durable deduplication, queued processing and private replies to channel mentions, direct messages and the requesting user's thread follow-ups. Invite the bot to each channel; it cannot read private channels it has not joined. Save the Slack client ID, client secret, and signing secret in Connectors → Slack. Set a public HTTPS `APP_ORIGIN` and register the callback URL, Events URL, and event subscriptions/scopes shown there. Install via Add to Slack and explicitly enable the bot. Slack rotating-token refresh is not implemented; expired tokens require reauthorization. Replies with uncertain delivery are recorded for review and never automatically resent.

Admins can explicitly link Slack member IDs to active workspace users in bot settings. This is an administrator-attested mapping, not automatic SSO account linking or email matching. Linked users retain their existing SSO-provisioned membership and current permissions, rechecked before generation and delivery; deactivation or changed links deny pending work. Public-channel responses are ephemeral to prevent disclosing private context to bystanders. Unlinked Slack identities receive no account knowledge access. Authored knowledge remains owner-only and is used in Slack only in the linked user's own workspace; no source permissions or delegated provider tokens are inferred from SSO. Gmail sender addresses remain separate unverified external identities and never inherit SSO/account knowledge permissions.

New Gmail authorizations activate intake and automatic replies for new mail, retaining explicit saved preferences on reauthorization. Outlook retains explicit opt-in activation. Both use the existing encrypted OAuth, bounded polling, automatic-message suppression, deduplication, scoped requests and audited reply delivery. Zuno offers resolution guidance and applies permitted routing; generated advice does not itself prove an issue was resolved or execute unconfigured external actions. Google OAuth credentials and required Gmail read/send scopes must be configured before authorization.

Workflow Permissions controls discovery and submission by all workspace users or a union of selected active users and Agent queues. Admins review/edit these grants in the Permissions tab or ask the Admin agent to propose changes; saving validates actual workspace references. Published grants are enforced on matching, request submission and SDK execution. Permissions do not grant source knowledge access or external execution rights. Workflow drafts autosave only after a manual edit or submitted chat; opening a workflow/history does not save it, and the manual Save button is removed.

Knowledge bases open dedicated detail pages with base-aware Add Topic/Add Article actions. Topic accordions load article lists only after expansion; tabs mount their data views on demand. Workspace bootstrap requests metadata only, visible components lazily fetch needed collections and lists request metadata projections instead of article bodies. Static page shells remain visible and shared accessible skeletons occupy loading sections, respecting reduced motion and forced colors.

### IT service desk data and consistent editing

Data includes empty, customizable Assets, Asset Models, Applications, Vendors, Contracts, Services and Software Licenses alongside workforce tables. Fields cover assignments, models, warranty and retirement dates, application/service ownership, vendors, contracts, renewals, costs and license seats, with typed workspace-scoped references to users and related records. These administrative tables do not automatically discover devices, enforce SLAs, reconcile counts or grant AI access. Add/Edit Record uses the full shared page width.

Queue assignments require existing workspace queues. An explicit chat request can propose a queue; the Admin reviews and clicks Create Queue before assigning it. Profile view/edit fields keep the same grid positions, with right-aligned pencils and double-click to enter whole-form edit mode; identity-managed data remains read-only. Skeletons occupy the eventual content regions. Chats scroll to inserted messages; employee forms appear after the assistant finishes. Code views use escaped syntax highlighting.

Connector application settings are Admin-only, version-checked and encrypted. Slack uses the displayed workspace-specific Events URL to select the correct signing secret before raw-body HMAC verification; installed team/app and workspace identity are still checked before events are queued. Gmail refresh uses the current workspace application credentials. Changing application details denies old installations immediately by version and requires reauthorization.

Inbox is operator-only and shows items assigned to the current Admin or Agent's queues; it does not include unrelated requester-owned items. Normal Users are redirected to Chat and receive 403 from Inbox APIs. Queue membership supports active Admins and Agents. Inbox rows show subject/status, requester, request number, a labeled queue and a compact details preview; request details also show the queue. Admin request-management access outside Inbox remains unchanged. Shared empty states use one message plus an action, without duplicate generic headings. The welcome Chat column keeps its own 800px maximum width; recent chats have quick hover and keyboard-focus backgrounds with reduced-motion support.

Request creation is handled in Chat. The standalone New Request form, list-page creation button and global Request option are removed; old `/tickets/new` links redirect to Chat. A successful chat submission appends one persistent assistant confirmation, including a read-only form-answer snapshot and request link, at the submission point in history. Follow-up messages appear after it rather than keeping a submitted form at the bottom. Request and article pages scroll their main content and details panels independently while the document/sidebar stay fixed.

Catalog exposes published workflows whose **Display in Catalog** switch is enabled and whose form and permissions allow the current user to request them. Selection starts a conversation with the published form; submitting creates a request linked to that conversation. Later form offers can create additional requests in the same chat, with per-offer retry deduplication and a request selector in the right details panel. Published permission checks also apply at submission. Local users can change their profile name; organizational fields remain Admin-managed and identity-managed profiles remain read-only. Read-only and disabled fields have distinct theme-aware backgrounds.

Agents and Admins in an assigned queue can claim an unassigned request with **Assign to Me**. Assignment uses version checks, refuses takeover and appears in Inbox and request details. Profiles include a cover/header, editable local display name and a self-managed PNG/JPEG/WebP photo (up to 5 MB, optimized to a 512px WebP image); photo reads require active workspace membership. Loading skeletons replace only dynamic values, while static controls remain visible. Empty lists show the empty state without table/search chrome; no-match searches retain their controls.

Knowledge article creation/editing now uses an Admin-agent conversation beside the editor. AI output is a proposal; Review Changes or Publish prepares a sanitized immutable preview, and **Approve & Save/Publish** is required to commit it. Preview can open a standalone authenticated page with the brand/profile header. Approval rechecks ownership and rejects an article changed since review; duplicate completed approvals return the saved result. No article proposal auto-saves. Field removals and deletion controls require confirmation, including field-removing code/chat updates; schema APIs return affected field IDs for explicit confirmation.

Workflow Settings includes Catalog visibility, description/category, audience, default queue, post-submission message, a 5–60 second execution timeout and a 1–10 per-workflow concurrency ceiling. These are published settings. The worker's total concurrency remains an additional ceiling. Expiring MongoDB slot leases recover after interruption; waiting approvals release their slot. Metadata queue edits retarget matching literal SDK route calls while preserving the rest of the run function; dynamic routing remains edited in TypeScript.

Article approval redirects newly created articles to their dedicated editor route and preserves the active conversation. The article History tab lists only that account/workspace's conversations attached to the article; reopening one continues the same chat. Proposals link their validated source conversation to the saved article only after explicit approval.

Split-panel editors and chat workbenches keep the outer page fixed to the viewport, with independent scrolling inside each pane. Regular chats remain centered until a request is submitted or a referenced article is opened in the side reader.

Role impersonation is stored on the authenticated server session, scoped to one workspace, and enforced on every request across tabs. Existing tabs cannot retain Admin API access by omitting or overriding a role header. Returning to Admin rechecks actual membership; impersonation never changes the saved membership. Browser storage only notifies tabs to refresh their displayed role.

### Current workspace controls

Requests use `/workspace/:workspaceId/requests`; old ticket links redirect. Inbox follows Chat in navigation and includes eligible assigned approvals. Read Only can be assigned to audit reviewers or selected during session-wide impersonation. Organization writes are denied for that role; account display preferences remain editable.

Knowledge permissions can be configured on each base, topic, and article. A base starts Admins Only. Explicit Workspace Members or Selected Users policies share authored Published articles, and all applicable levels must permit the reader. Employees browse the Knowledge Center rather than management tables. Both agents recheck authored knowledge permissions before using retrieved context. These permissions do not replace delegated source checks for historical imported knowledge.

Articles support up to 10 attachments, each at most 10 MB. Binaries stay in MongoDB. Authenticated downloads recheck the article policy, use attachment disposition and no-store responses, and do not render uploaded executable content. Attachment text is not automatically extracted, embedded, or sent to AI providers. Removing an attachment changes the approved article reference; it does not erase historical binaries. Newly approved articles redirect to their editor; their conversations remain available under History. Completed agent proposals automatically open the approval preview and require explicit approval to save.

Shared lists load pages on the server, default to 20 records, and persist the account's 10/20/50/100 page-size preference. First/Last controls accompany Previous/Next. Unsaved form edits show a custom confirmation before route navigation; refresh/close uses the browser's built-in unload prompt.

### Invitation email

Configure Settings → Outgoing Email (SMTP), then use Test Connection. Host, TLS port (465 or 587), sender and credentials are stored encrypted per workspace in MongoDB. Passwords are never returned to the browser. SMTP environment fallbacks are removed. Connection attempts validate public DNS and require verified TLS. Configure a canonical `APP_ORIGIN` for invitation links. Add User queues an invitation without requiring an existing account. The recipient signs in or registers with the invited address and explicitly accepts to receive the saved workspace membership and role. Links expire after seven days. Tokens are hashed; queued message payloads are encrypted. SMTP failures/ambiguous sends are not automatically resent. Delivery requires a running worker, normally dispatched within 30 seconds; live SMTP delivery requires deployment validation. The Users invitation endpoint reports delivery state. Identity-provider-enabled workspaces reject manual invitations.

### Audit report and retired integrations

Reports → Audit shows workspace-scoped API and database actions with server-side search, sort and pagination. Shared MongoDB wrappers record mutation metadata, affected field names, actor, versions when supplied, timestamps and outcomes. They exclude raw credentials, prompts and record contents. Background records without tenant metadata cannot be attributed to a workspace; this is an application audit trail, not a cryptographically immutable log or a full before/after content archive. Production operators must also monitor infrastructure and database access outside the app.

New knowledge-source integration setup has been retired from the catalog and connection-create endpoint. Custom snapshots and active employee-channel connectors remain. Historical saved source connection readers and authorization checks are retained so existing data is not silently deleted or made accessible through weaker permissions.

Public documentation is at `/docs`, with the executable SDK guide at `/docs/workflows`. The workflow builder links there instead of maintaining an SDK tab.

Connector OAuth application IDs and secrets are configured in each workspace's Connectors pages and stored encrypted in MongoDB. Environment credential fallbacks have been removed, including the old global Slack signing-secret path. The environment files retain deployment settings (database/service URLs, encryption, and HTTPS/origin), not per-connector identities. The Vite proxy allows the public SDK's JavaScript, type declarations and README as local source assets so public docs also work during development.

The marketing page includes a responsive left-copy/right-flow hero, a scroll-triggered chat/form walkthrough, industry request scenarios, workflow/knowledge/governance sections and a two-agent explanation. Content reveals run once per page mount and respect reduced motion. Signed-in visitors see their avatar and Open Workspace; Login redirects existing sessions to their active workspace.

Saved support-chat forms resolve the latest published workflow revision and current access on each load. Republishing a workflow refreshes an existing unsubmitted form; stale submissions are rejected and the chat refreshes for review rather than resubmitting automatically. Submitted requests retain their original answers and workflow revision.

Shared list pagination uses numbered page controls, a centered page/record count, and a right-aligned record-limit dropdown. Record limits remain server-loaded and saved as account preferences.

Catalog categories live in Data → Catalog Categories and are selected by reference from workflow Settings when Display in Catalog is enabled. Categories contain related-workflow lists; employees expand category sections to see cards. Icons and bounded catalog images are configurable per workflow. Built-in schemas are protected; administrators may add custom fields. Users, Groups and Workflows expose live records in Data with protected core fields and separate editable custom values.

Groups combine former queues and approval groups. Assignment Group and Approval Group switches control eligibility without changing current role checks. Existing assignment names and approval group IDs are retained. Legacy queue APIs remain compatibility aliases.

Connector configuration pages include provider-specific setup instructions. Slack's generated manifest uses `messages_tab_read_only_enabled`. Teams currently authorizes delegated Graph access; native Teams bot installation and message delivery remain unimplemented. Live provider credentials and SMTP delivery need validation in your environment.

Catalog items use compact app-launcher tiles grouped by category. Chat remains editable during response generation, with Send unavailable until ready. Explicit follow-up requests can reopen the previously submitted workflow form without requiring its exact name; submission remains explicit. Selecting a different request resets only its details pane to the top.

Admins can select records on the current Requests or Knowledge Articles page and use Delete Selected. A confirmation describes the permanent removal. Source-managed articles cannot be deleted here. Active/uncertain workflow actions block request deletion; pending runs stop when the request is removed. Governance and workflow run history remain. Authored article retrieval reads MongoDB directly, so deleted articles stop being available immediately; uploaded attachments are removed only when no other authored article references them.

## License

AgentZuno is licensed under the [Apache License 2.0](LICENSE). The workflow SDK uses the same license. Third-party dependencies retain their respective licenses.

The workflow Visual tab includes a collapsible request-form preview between the trigger and routing steps whenever the workflow has a form. Preview values do not modify the workflow or submit requests.

Workflow Visual controls zoom from 50% to 150%, with collapsible form previews scaling alongside the steps. Department scope in Workflow Settings uses the configured Departments table; leave it empty for Any Department. New workflows use `trigger.departmentId` instead of fixed organizational categories. Legacy department strings remain readable for compatibility.

The employee Catalog uses a centered app-launcher layout with uniform icon/image tiles and collapsible category sections. Search stays server-side; infinite scrolling fetches 20 records at a time, with an accessible Load More fallback.

Dynamic content uses short opacity reveals while retaining existing records during refresh. Recent Chats keeps its title and composer static; matching placeholders occupy the list area until the first result arrives. Reduced motion disables reveal animations.

My Work is the first navigation item and default landing page for Admins and Agents. Its assigned-request list supports server-side search, sorting and pagination; summary reports count only current-workspace requests assigned to that person and still permitted by their role/group scope. Users and Read Only roles continue to land on Chat. Both themes use AgentZuno's #818CF8 brand purple, with a darker purple text accent in Light mode for contrast.
