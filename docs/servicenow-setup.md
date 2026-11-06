> The Connected agents UI and external token/MCP endpoints are retired. Any client setup instructions below are historical; current use is through authenticated workspace search. Source ACL and vector indexing requirements still apply.

This guide is for Admins configuring the installation or its connections. Agents and Users use the published features their permissions allow; Read Only users inspect permitted records without changing configuration. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

# ServiceNow knowledge setup

ServiceNow is the only built-in source. Custom JSON/API snapshots remain available from the Custom connection action. Other provider adapters are retained only for legacy records and are not offered for new connections.

## 1. Start AgentZuno

Keep your existing `.env`. On a new installation, copy `.env.example` to `.env`, then set a random 32-byte base64 `CREDENTIAL_ENCRYPTION_KEY` (use `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Use HTTPS with `COOKIE_SECURE=true` for a hosted deployment.

```sh
docker compose up -d --build
docker compose logs -f ollama-model
```

The one-shot model service downloads `nomic-embed-text` into a persistent volume. Qdrant and Ollama have persistent volumes and bind their optional host ports to loopback only. Their internal URLs are passed to the API and separate BullMQ worker. The model and container images require downloads on first start; pin tested image/model digests for production.

For a local API outside Docker, set `OLLAMA_URL=http://127.0.0.1:11434` and `QDRANT_URL=http://127.0.0.1:6333`, alongside MongoDB/Redis URLs. Run the API and worker separately. Without semantic services, keyword retrieval remains available and reports its retrieval mode honestly.

## 2. Install the ServiceNow permission bridge

An administrator must install and validate the files in `integrations/servicenow/`:

1. Install `AgentZunoKnowledge.js` as a **Global, non-client-callable Script Include**, accessible from your integration application's scope.
2. Create an authenticated Scripted REST API with ID `knowledge` in a namespace such as `x_company_agentzuno`.
3. Add GET `/me`, `/articles`, `/articles/{id}`, and `/knowledge-bases` using the provided resource scripts. Require authentication and appropriate execute access on every resource. Resources call `global.AgentZunoKnowledge`; approve required cross-scope privileges.
4. Register an OAuth application in ServiceNow and obtain a **delegated user OAuth access token** for the intended reader. AgentZuno currently accepts this token manually; it does not perform a ServiceNow browser OAuth handshake or refresh expired tokens automatically. Do not substitute a shared admin/client-credentials identity for a restricted user.
5. Test with a restricted non-admin account: record and field ACLs, knowledge-base ACLs/title fields, KB/article user criteria, scripted criteria, retirement, deletion, and revoked access must deny access as expected. The scripts use `GlideRecordSecure` and `KBKnowledge.canRead`; missing APIs or errors must fail closed.

The bridge is deployment-assisted. Its behavior must be verified against your ServiceNow release, plugins, and custom criteria. No live ServiceNow tenant has been available for validation during development.

## 3. Connect and import

Sign in to a registered AgentZuno account, open **Connections → ServiceNow**, and enter the instance subdomain, application namespace, and delegated OAuth token. Choose **Source enforced** to maintain ServiceNow permissions. Managed copies are a separate policy and do not synchronize source restrictions.

Choose **Create knowledge bases with source names** to preserve source grouping, or bundle into one existing base. Verify and connect, browse the readable source bases, and select **Import now**. Source discovery lists only bases with readable published articles, not empty or inaccessible bases.

MongoDB stores completed-generation article snapshots, source IDs, source base metadata, owner/workspace IDs, and chunks/embeddings. Failed imports retain the previous completed snapshot. The worker schedules imports every five minutes, with leases, bounded provider concurrency, retries, and Retry-After handling; it is not a real-time ACL mirror.

The semantic worker chunks text into overlapping 1,800-character segments, embeds batches locally with the fixed 768-dimensional model, and writes vectors to Qdrant's `agentzuno_knowledge_v1` collection. MongoDB has ownership/base/generation and job-state indexes; Qdrant has keyword payload indexes for owner, workspace, knowledge base, document, and generation, plus its cosine vector index. Vectors use deterministic IDs so retries overwrite the same points. Completed replacement generations retire previous vectors/chunks in background cleanup.

The connection page shows vector indexing counts and a refresh action. `Pending` waits for the worker; `Needs attention` usually means the model or Qdrant is unavailable. Search uses keyword fallback if semantic services fail. Content is not sent to the configured chat AI provider for embeddings.

## 4. Connect one or more agents

Create each client under **Agents**, enable it, and explicitly select its allowed knowledge bases. Each agent has independent grants and tokens. Token creation only asks for a name and expiry; tokens inherit the agent's current grants. Revocation, expiry, disabling the agent, and grant changes are enforced on subsequent requests. Token secrets are shown once and stored as hashes.

Configure your agent with `POST https://YOUR_AGENTZUNO_HOST/api/mcp` and `Authorization: Bearer <AgentZuno token>`, or use REST:

```sh
curl https://YOUR_AGENTZUNO_HOST/api/knowledge/search \
  -H "Authorization: Bearer $AGENTZUNO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"How do I request VPN access?"}'
```

Agents can first call the MCP `list_knowledge_bases` tool or `GET /api/knowledge/bases` with the same bearer token to discover permitted bases. Source-imported base names are verified against current source access.

Optional `knowledgeBaseIds` narrows the query within the agent's grants; it is not another saved permission setting. Responses include `results` and `retrievalMode` (`hybrid`, `keyword`, or `keyword-fallback`). No token grants write access.

Vector retrieval filters owner, workspace, base, and active generation. Every candidate is checked again in MongoDB against current connection state and current agent permissions; source-enforced content is then read again through ServiceNow as the connected user. A denied, deleted, changed-identity, timed-out, or unavailable source result is withheld, including its title and snippet. Cached vectors never authorize access by themselves. Similarity search is approximate and bounded; it may omit relevant records.

An AgentZuno token acts for its workspace owner's connected ServiceNow identity. Separate people must use their own accounts/connections; this version does not implement an enterprise directory/group membership model or accept arbitrary per-query ServiceNow identities. Do not share an owner's agent tokens with unrelated people. HTTP MCP supports manual bearer configuration; OAuth discovery/DCR is not implemented.

## Saved forms

Authored articles, created knowledge bases, topics, file metadata/replacement uploads, agent details/grants, saved source settings, snapshot metadata/reimports, token name/expiry, AI providers, and identity-provider settings can be edited. Edits validate ownership on the API. Source articles remain read-only; edit them in ServiceNow and sync. Token secrets cannot be recovered or edited: revoke and issue another token to rotate a secret.

## Local semantic smoke check

```sh
docker compose exec -T worker node src/knowledge/checkSemantic.js
```

This check uses an isolated MongoDB database and synthetic text, verifies real local embeddings and Qdrant retrieval, and removes its own test records and vectors. It does not validate a real ServiceNow tenant.

References: [Ollama embedding model](https://ollama.com/library/nomic-embed-text), [Qdrant query filtering](https://qdrant.tech/documentation/search/filtering/), [ServiceNow Knowledge API](https://www.servicenow.com/docs/r/api-reference/rest-apis/knowledge-api.html).
