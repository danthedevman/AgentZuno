# Architecture and workflows

Admins manage configuration and published workflows. Agents work on permitted support records, Users submit and follow their requests, and Read Only users inspect permitted records without changing them. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

AgentZuno uses Solid.js and Vite for the web application, an independent Express API, MongoDB or PostgreSQL through the storage adapter for authoritative state and uploaded binaries, and a separate BullMQ worker coordinated through Redis. Qdrant and local Ollama embeddings support separate authored-article and retained source-import indexes. Both application agents use permission-checked hybrid semantic/keyword retrieval for Published authored articles.

## Two agents

- **Admin agent:** Helps authorized administrators design workflows, data schemas, and article changes. Article proposals require preview approval before saving. Workflow drafts autosave after edits; publication remains explicit.
- **Zuno:** Helps employees find permitted published knowledge, complete conversational forms, and submit requests. Employee conversations cannot invoke Admin actions.

Providers must be configured before AI generation is available. Server-side authorization applies independently of model instructions.

## Workflow lifecycle

1. An administrator creates or edits a workflow conversationally or manually.
2. The workflow combines validated metadata, an optional form, routing, permissions, approvals, settings, and executable TypeScript.
3. A draft autosaves only after an edit. Publish creates the active revision; Unpublish prevents new offers and execution authorization.
4. An authorized employee discovers the form through chat or the Catalog. Catalog search runs server-side and loads additional items incrementally.
5. Explicit form submission validates the current published revision and answers, creates a request associated with its chat, and records a durable workflow run.
6. A worker loads that revision and transpiles its TypeScript. QuickJS executes the resulting JavaScript in a worker thread, with memory, stack, time, and action-count limits.
7. SDK calls cross an authorization gateway. Actions must match declared grants, destinations, current membership, and connector configuration. The sandbox has no direct filesystem, network, database, or credential access.
8. Approvals pause execution and surface in the intended approvers' Inbox. On resumption, stored step results support replay and deduplication. External delivery is not guaranteed exactly once; uncertain delivery requires review.

Implemented runtime actions cover routing, handoff, approvals, fulfillment task creation, and Slack messages. ServiceNow and Jira execution are not implemented. The public workflow SDK documentation is available at `/docs/workflows`, with package sources in [api/sdk/workflows](../api/sdk/workflows/README.md).

## Departments, groups, and data

Workflow department scope uses an optional `trigger.departmentId` reference to the configured Departments table. No reference means Any Department. The API validates ownership and rechecks the requester's profile during discovery, submission, and execution. Legacy department text remains readable for compatibility.

Groups have independent assignment and approval switches. Assignments and approvals must reference active eligible groups and users. Manager approvals resolve the requester's profile reference; profiles and custom data do not silently grant permissions.

Admins can create typed custom Data tables and add fields to built-in tables. Built-in tables and fields are protected from deletion. Reference lookups store validated IDs and can open the referenced record.

## Workspace experience

Admins and Agents land on My Work, with their assigned requests and scoped workload reports. Inbox contains permitted work and approval items; My Requests tracks accessible requests. Chat and request details share one route, and the panes scroll independently.

Knowledge is organized into bases, topics, and articles. Base/topic/article policies intersect; employee retrieval requires permitted Published content. Article attachments inherit access. Private chat uploads remain scoped to their conversation and permitted participants.

Shared tables use server-side search, sorting, pagination, and saved page-size preferences. Dynamic sections retain content during refresh and use short, reduced-motion-aware reveals. Admin bulk deletion requires confirmation; audit and workflow run history remain.

## Source layout

| Path                   | Purpose                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/`           | Solid route screens, grouped into public, authentication, setup, and workspace features                                                           |
| `src/layouts/`         | Application and workspace shells                                                                                                                  |
| `src/components/`      | Shared controls plus feature folders for chat, workflows, knowledge, requests, records, identity, settings, connectors, data, and marketing       |
| `src/context/`         | Shared reactive state                                                                                                                             |
| `src/services/`        | API clients and browser helpers; chat, workflow, and public-site helpers have feature folders                                                     |
| `src/styles/`          | Public-site and workspace styles                                                                                                                  |
| `api/src/index.js`     | Installation initialization and process startup                                                                                                   |
| `api/src/server.js`    | HTTP server creation and close lifecycle                                                                                                          |
| `api/src/app.js`       | Express dependency composition and ordered middleware/route installation                                                                          |
| `api/src/routes/`      | Endpoint registration, grouped by feature; preserves route paths and middleware order                                                             |
| `api/src/controllers/` | HTTP handlers, grouped by feature; validates requests, calls services, and formats responses                                                      |
| `api/src/middleware/`  | Browser-origin, identity, workspace, and request-body middleware                                                                                  |
| `api/src/<feature>/`   | Business services for identity, chat, workflows, requests, knowledge, data, records, channels, integrations, audit, demo, and workspace reporting |
| `api/src/shared/`      | Shared validation, secrets, binary, and query helpers                                                                                             |
| `api/src/storage/`     | MongoDB/PostgreSQL adapters, installation configuration, and audited store access                                                                 |
| `api/src/connectors/`  | Provider adapter implementations and registry                                                                                                     |
| `api/src/worker.js`    | Separate background worker entry point                                                                                                            |
| `api/sdk/workflows/`   | Workflow SDK and TypeScript types                                                                                                                 |
| `api/test/`            | Behavior, database parity, and isolation tests                                                                                                    |
| `api/mock-data/`       | Fictional development fixtures                                                                                                                    |

Routes contain URL/method declarations and middleware wiring. Controller factories bind explicit service dependencies and return named handlers; feature services enforce the same authorization and validation for forms, AI tools, and background jobs. Moving an HTTP handler into a controller never makes its service checks optional. Raw-body Slack verification stays ahead of the normal JSON parser, installation setup remains available before database configuration, and audit/error middleware retains its original ordering.

When adding a feature, use its existing service, route, controller, and frontend feature folders. Keep shared controls in one place, import modules directly, and avoid adding forwarding files at obsolete paths. The API and worker startup commands remain unchanged.

## Demo and request actions

Admins load and remove demo data only from Settings, using an industry selector and explicit actions. Versioned JSON configuration creates tagged records in the current workspace: published catalog workflows with real executable TypeScript and request forms, published knowledge with a base and topic, assets, an assignment group, and submitted requests with originating chats. The records are fictional and use ordinary workspace permissions and reports. A connected AI provider can retrieve the demo knowledge and offer the workflows. Built-in demo actions route internally and do not send external notifications. Administrators can edit the seeded workflows like other workflows.

Loading the same configuration again preserves existing tagged records. A scoped lease serializes load/removal; interrupted operations can be retried. Removal requires confirmation, blocks active or uncertain workflow delivery, retires article vectors through durable tombstones, and removes only tagged data. Requests submitted from demo workflows inherit the dataset tag and are included in removal. Shared conversations, real data, run history and governance logs are retained. Real workflows or articles referencing demo groups/categories/knowledge must be updated before removal. Demo records contribute to normal workspace reports until removed.

For an employee's own request, Zuno can propose a comment. Admins/Agents who also have operator access can propose work notes, status/priority changes and self-assignment where eligible. A review card requires confirmation before the mutation. The server verifies ownership, originating chat, current effective role and request version and claims each proposal once. No approval, deletion or arbitrary record edit is available through this action format.

## Exports and audit detail

Shared record tables export CSV and JSON across server-loaded pages using the current search, sort and filters, up to 10,000 records. CSV exports displayed fields and neutralizes spreadsheet formulas; JSON preserves the API's authorized record representation. Exports are audited without retaining exported contents. Large datasets require a narrower query. Concurrent source changes can invalidate an export; these are not database-wide transactional snapshots.

Audit rows open a scoped detail route with actor/effective role, timestamps, outcome, field names, versions, mutation counts and related correlated/resource events. Database mutations inside worker operations inherit their correlation ID. Logs retain metadata rather than credentials, raw messages or arbitrary record values. Older events retain only the fields recorded when they occurred. This is not cryptographic tamper protection or an immutable compliance archive.

## Authored knowledge indexing

Manual saves, approved conversational edits and publication changes mark the article Pending with a fresh generation in the same MongoDB write. The scheduler discovers existing articles for backfill and sends only identifiers to the vector worker. The worker uses a renewable MongoDB lease, local `nomic-embed-text` embeddings, bounded chunks/batches and generation checks before marking an index Ready. Failed work remains retryable in MongoDB. Article edits retire prior chunks; unpublished articles and durable deletion tombstones retire their vectors and local chunks. The scheduler normally discovers new work on its next minute cycle; backlog and model availability can delay indexing.

The authored Qdrant collection and MongoDB chunk collection are separate from imported-source indexes. Queries filter owner, workspace, permitted knowledge bases and current indexed generations. MongoDB then rechecks the authoritative article and intersected permissions before any content enters model context. Permission revocations take effect immediately, even while vector cleanup is pending. Search combines current vector candidates with keyword matches; outages preserve authorized keyword fallback. This does not make uploaded chat files or article attachments searchable shared knowledge.

Run `MONGODB_URI=... OLLAMA_URL=... QDRANT_URL=... node api/scripts/check-authored-knowledge.mjs` to verify a real semantic match using isolated synthetic records. The script retires its vectors and drops its temporary test database.

## Personal and team reporting

My Work is restricted to the current Admin or Agent's assigned requests and offers Assigned Requests, Awaiting Response, Resolved and Workload tabs. My Team is available in Reports: Admins and Read Only reviewers see assignment groups across the workspace; Agents see groups in their current assignment scope. Counts and lists use the same server authorization filters. Team reports are a current-state overview, not a historical trend.

## Setup and lifecycle controls

Registration opens a skippable setup wizard for the AI provider, channels, and knowledge. Invitation acceptance retains its direct route. Skipping AI setup never claims responses are generated; a slim workspace banner links Admins to AI settings. Users are managed on their profile page, with workspace access settings beside the workforce profile. Deletion removes a workspace membership while retaining the person's global account, request history and governance records. Identity-provider-enabled workspaces reject manual user deletion. Custom-table deletion requires the current name, version, and confirmation; built-in tables remain protected.

Audit filters can narrow events to a workflow and initiating trigger. Workflow steps include the run, request, and step identifiers, while Admin chat records retain a conversation correlation without prompt text. Older events may lack these fields.
