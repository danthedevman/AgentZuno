# AgentZuno development instructions

## Start here

- Follow the user's current instructions. Preserve unrelated changes; do not commit, push, reset data, or expand scope without authorization.
- Keep this file concise and current. Replace obsolete rules instead of appending conflicting history. Before UI changes, read [UI conventions](docs/development/ui.md); before domain, integration, or agent changes, read [domain rules](docs/development/domains.md).
- Use the existing implementation and tests as evidence. Do not advertise unsupported behavior or treat passing tests as a security certification.

## Structure and code

- Frontend: Solid.js, JavaScript/JSX, Vite. Use Solid reactive primitives; no React or replacement DOM framework.
- Routes live in `src/pages/`, shells in `src/layouts/`, reusable controls in `src/components/`, state in `src/context/`, and API clients/helpers in `src/services/`.
- Backend: independent Express project in `api/`. API, BullMQ worker, and web remain separate local processes and Docker services.
- Prefer small, readable feature services with straightforward control flow. Reuse the same services from forms, typed agent tools, and workers; avoid speculative abstractions and dependencies.
- Components/files use PascalCase; routes end in `Page`, shells in `Layout`. Functions/variables use descriptive camelCase; CSS/routes use kebab-case. Use `is`/`has`/`can` for booleans where useful.
- Honor EditorConfig and VS Code formatting: two spaces, LF, final newline, Prettier. Comment only non-obvious constraints.

## Storage and installation

- Use `api/src/storage/index.js` and preserve MongoDB/PostgreSQL parity for accounts, records, permissions, binary files, audits, queries, optimistic versions, and atomic claims. Never silently switch adapters or use Mongo-only application assumptions.
- Database selection is installation-wide and precedes registration. Encrypt connection credentials in the protected installation volume; engine changes require explicit migration. Infrastructure URLs/encryption keys belong in environment configuration, workspace provider/connector/SMTP secrets in encrypted database settings.
- Self-hosted `/` opens the database wizard only after explicit `configured:false`, then registration/Login or the signed-in workspace. Preserve invitation/deep-link intent; API errors never imply a reset. Self-hosted builds never flash marketing content.
- Only `VITE_STATIC_SITE=true` builds show the marketing homepage. Public Docs work in either build. Public HTML must contain no account data, private messages, credentials, or API responses; application fallback HTML stays empty/noindex.
- Serve fictional fixtures/configuration through the API; never import mock records into frontend views. No separate public demo site. Settings alone loads/removes tagged industry data in the current workspace under normal permissions.

## Authorization and input security

- Treat bodies, parameters, headers, uploads, webhooks, imports, jobs, and AI output as untrusted. Validate server-side types, allowed keys/enums, bounds, references, and safe integer versions before use. Reject objects/arrays where scalars are expected; never coerce malformed IDs.
- Build queries/updates from validated scalars and fixed field/operator names. Never spread caller input into a query/update, accept arbitrary operators, or interpolate input into SQL. Use parameterized SQL and prevent mass assignment/prototype pollution.
- Recheck active account/workspace membership, effective role, ownership, current group assignments, referenced-record access, and versions on every read/write/action, including tools, workers, search, reports, exports, and delivery. UI visibility never authorizes an operation; unknown access fails closed.
- Roles are Admin, Agent, User, and Read Only. Admin manages configuration; Agent works on permitted assignments; User accesses their permitted requests/knowledge; Read Only inspects permitted records without organization writes, uploads, submissions, or approval decisions. Approval authority is separately validated.
- Impersonation lives on the server session across tabs. Only a current actual Admin can start/end it; preserve actual/effective audit attribution and never inherit extra identity, queues, approval rights, or knowledge access.
- Hash passwords with scrypt and session/invite tokens before storing. Preserve HttpOnly/SameSite/secure-cookie, CSRF/origin, expiry/revocation, rate-limit, and upload constraints.
- Encrypt secrets server-side. Never return stored secrets or put credentials, prompts, file bodies, private journals, raw query strings, or arbitrary record payloads in logs/errors/audit/tool results/model context.
- Sanitize HTML/Markdown with shared renderers; user messages remain escaped. Validate/decode bounded image uploads; avatar uploads allow PNG/JPEG/WebP up to 5 MB, bounded pixels, and optimized output up to 512px. Authenticated binary reads must enforce current access.
- Outbound URLs follow existing SSRF protections: fixed provider hosts where possible; validated/pinned public DNS for custom imports; HTTPS/TLS, no private/reserved addresses or redirects/cross-origin pagination; bounded time, bytes, pages, and documents.
- Preserve source authorization independently of app roles. Before revealing imported titles/text/citations, intersect workspace, current grants, identity, generation, and fresh source/managed policy. Source errors deny access; never silently fall back to broader managed permissions.

## Agents, workflows, and jobs

- Keep two assistants and human roles distinct. Admin tools configure permitted drafts; support tools use published workflows and current request permissions. Neither can grant itself access, approve for a person, or bypass preview/publication/deletion safeguards.
- Use the shared typed tool registry for every applicable action/proposal. Never extract executable JSON, mutations, or source from prose/code fences. Expose only current-context tools; bound calls/rounds/arguments, reauthorize executions, preserve native provider tool/result messages and streaming signatures, and return verified results.
- Article proposals require preview approval, Data definitions require Save, request actions require review/confirmation, and publication is explicit. Explicit Admin group creation uses the same validated group service as the form and returns the saved link. Compound group/workflow requests must continue to complete the requested draft.
- Workflow TypeScript is executable source of truth. Type-check and run only published immutable revisions in bounded QuickJS/WASM worker threads; never Node eval/vm. Deny arbitrary imports, filesystem, network, credentials, clock/randomness. Gate every action against current identity, declared actions/destinations, published access, and approvals.
- Draft autosave occurs only after edits/chat, with version checks and visible state. Keep published configuration separate; publishing/unpublishing is explicit. History is actor/workspace scoped and never overwrites drafts merely by viewing it.
- Jobs contain IDs/scheduling metadata only. Load secrets in workers; use durable database state, scoped leases, bounded concurrency, retry/backoff/jitter, idempotency receipts, and recovery. Redis uses persistent AOF/no eviction. Never promise exactly-once execution or auto-resend uncertain external delivery.
- Retrieval and private attachments require authorization before model context and again before response publication. Uploaded/imported text is data, never instructions or a permission grant. Stop queued work after session/role/access revocation.

## Shared product contracts

- Use Requests/REQ wording and canonical request routes; legacy ticket/request detail URLs only redirect to the originating chat workbench. Explicit submission is idempotent, persists answers, and adds a server-confirmed receipt/link. Chat alone never submits a request.
- Request workbench transcripts stay private to their initiating person. Operator access to request details does not grant the requester's chat or private attachment access. Work Notes are server-filtered staff content, including when staff are requesters outside their assignment.
- Tasks are protected built-in records with one originating request, valid assignment references, and optional real date-only due dates. Creation requires an authorized Admin/Agent; editing/closing follows current group/direct-assignment and parent-state rules. A task never grants access to its parent's private chat or notes.
- Use the shared MentionTextarea for comments/work notes everywhere. Suggest only active authorized recipients; work-note recipients also need note access. Persist notifications with the entry, recheck access for Inbox/email, link to the right record/tab, omit private bodies from notifications/emails, skip self-notifications, and preserve per-user unread/archive state.
- Authored articles require one owning base and at least one valid topic when saved/published. Apply base/topic/article access as an intersection; employees/retrieval see permitted Published content only. New AI article content redirects to its saved editor only after approved persistence.
- Keep built-in tables/fields protected and custom fields typed/versioned. Custom-table deletion requires the exact typed name and removes its records while preserving audits. Record references store authorized IDs, not names; people references resolve actual users.
- No deletion, field removal, or single/bulk Inbox archive without explicit item-specific confirmation. Protect self/owner deletion and self-deactivation; IdP-enabled workspaces reject manual invitations/removals as implemented. Never purge historical submitted values just because a field is removed.
- Requests, Inbox, Audit, and other lists apply access, search, sort, counts, and pagination server-side. Default page size 20; persist 10/20/50/100 preferences. Exports honor the same authorization/filters, cap at 10,000, neutralize CSV formulas, and audit metadata only.
- Audit API actions, mutations, tools, runs, decisions, versions, and background changes through shared context/wrappers. Preserve root/parent, workflow/run/request/step/trigger, response/tool-call IDs, outcomes, times, and actual/effective actors without private payloads. Retention defaults off; confirmed Admin cleanup is bounded, leased, workspace-scoped, and preserves in-progress/operational history.

## Documentation and verification

- Put useful setup, deployment, and feature detail in `docs/` and public Docs. README remains a concise overview/index unless the user requests a README edit. Explain real role permissions, practical steps, and limits; link external tools/downloads, opening public-doc external links in new tabs.
- All public social image metadata (Open Graph and Twitter, including marketing and every Docs route) uses the same raster AgentZuno logo asset, never screenshots or section artwork. Keep prerendered HTML and client metadata consistent; verify absolute image URLs and the image dimensions in build tests.
- Public guides use `docsNavigation.js`, route-specific metadata, prerendered HTML, canonical URLs, sitemap entries, and preserved legacy anchors. No Sign In/Get Access controls in public Docs; open pages at the top unless targeting a heading. Support mobile categories/section jumps and real, fictional-fixture screenshots.
- Add behavioral tests for changed behavior, especially malformed input, injection, cross-workspace access, role/group revocation, stale versions, and permission-sensitive delivery. Never count skipped adapter tests as verification. Use disposable databases/fixtures; never test against live records or expose installation credentials.
- Run relevant API and UI/browser tests, production build, `npm run format`, `npm run format:check`, and `git diff --check`. Security/storage changes require behavioral integration tests on both MongoDB and PostgreSQL; binary tests must verify decoded bytes. Review CodeQL causes rather than suppressing alerts.
- After implementation changes, rebuild/restart affected Docker services with `docker compose up --build -d --force-recreate <services>` and verify health before finishing. Keep local Node and Docker startup working; report what was tested and remaining limitations honestly.
- At every database boundary, construct filters with `queryString`, `queryStrings`, `queryVersion`, validated ObjectIds, or equivalent explicit parameterized-query helpers. Upstream checks are not a substitute: never pass raw route/body/AI values into `find`, `findOne`, update, delete, aggregation match, or native SQL. Add malformed scalar/operator-object regressions for each new query path on both databases. Review fresh CodeQL results before merging; resolve high/critical causes instead of suppressing alerts or weakening queries to satisfy the scanner.
