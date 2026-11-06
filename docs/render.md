# Deploy on Render

Admins use this guide to run AgentZuno on [Render](https://render.com/). Agents, Users, and Read Only reviewers use the deployed workspace with their existing permissions; they do not need Render accounts. See [roles and features](roles-and-features.md) for access details.

## What gets deployed

The repository includes a [Render Blueprint](https://github.com/danthedevman/agentzuno/blob/main/render.yaml). It provisions six paid services. MongoDB Atlas is configured separately.

| Service            | Purpose                                                        | Exposure and storage                                                         |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `agentzuno-web`    | Nginx web application and API proxy                            | Public HTTPS entry point                                                     |
| `agentzuno-api`    | Express API                                                    | Private service; reads the selected application database                     |
| `agentzuno-worker` | Chats, workflows, email polling, indexing, and queued delivery | Background worker using the same database and encryption key                 |
| `agentzuno-redis`  | Durable job coordination                                       | Private Key Value instance with no eviction and journal/snapshot persistence |
| `agentzuno-qdrant` | Knowledge vector indexes                                       | Private service with a persistent disk                                       |
| `agentzuno-ollama` | Local `nomic-embed-text` embeddings                            | Private service with a persistent model disk                                 |

Ollama supplies embeddings, not conversational answers. Configure your chat AI provider inside AgentZuno after registration. Application records and uploaded binaries live in the selected MongoDB or PostgreSQL database.

## Prepare your repository and database

1. Fork or push AgentZuno to a Git repository you can connect to Render. Keep secrets and `.env` out of Git.
2. Create a [MongoDB Atlas deployment](https://www.mongodb.com/docs/atlas/getting-started/) near the Render region. The checked-in Blueprint uses Oregon. Change every service's region together before creating resources if another region suits you better.
3. Create a database user scoped to `agentzuno`. Copy the Atlas connection string, replace its placeholders, and use `agentzuno` as the database name. Keep required Atlas connection options intact.
4. Configure the [Atlas IP access list](https://www.mongodb.com/docs/atlas/security/ip-access-list/) for the API and worker's Render outbound addresses. Use the addresses shown by Render for those services; do not assume your laptop's IP authorizes the cloud services. Avoid opening the database to every address.

## Create the Blueprint

1. In the [Render dashboard](https://dashboard.render.com/), choose **New → Blueprint** and connect your repository and branch.
2. Select the root `render.yaml`. Review the service plans, region, persistent disks, and total estimated cost before creating resources. This is a paid multi-service deployment.
3. Enter `MONGODB_URI` when prompted. The worker receives the API's value through the Blueprint reference.
4. Deploy, then confirm the API and worker can connect to Atlas. If Atlas blocks them, update its access list and redeploy the affected services.
5. Wait for the embedding model download in the Ollama logs. Knowledge indexing can retry while it becomes available.

Render generates `CREDENTIAL_ENCRYPTION_KEY` on the API and shares it with the worker. Preserve a protected backup of that exact key. Replacing it without migrating encrypted records makes saved credentials unreadable. See [Render environment variables and secrets](https://render.com/docs/configure-environment-variables).

The Blueprint wires `APP_ORIGIN` to the web service's public HTTPS URL, `API_UPSTREAM` to the private API, and the queue/vector/embedding addresses to their private services. Keep these references intact when renaming services. The web proxy keeps browser API calls and cookies on one origin.

## Complete first setup

Open the web service's HTTPS URL and register your Admin account. The Render startup script uses environment-based database configuration, so this deployment goes to registration rather than the database-selection wizard. Do not add separate installation volumes to the API and worker to imitate the local shared setup volume.

Complete or skip the account setup wizard. Configure AI providers and SMTP in Settings and application credentials in Connectors; these settings are encrypted in the database. Load fictional data from Settings if you want to explore workflows before creating your own records.

## Use PostgreSQL instead

PostgreSQL is supported by the application, but the checked-in Blueprint provisions neither a PostgreSQL database nor its connection settings. Make this choice before registering accounts; changing engines is not a data migration.

1. Provision [Render Postgres](https://render.com/docs/postgresql) or another trusted PostgreSQL service in the same region where practical.
2. In your own Blueprint, replace the API's `MONGODB_URI` declaration with `DATABASE_PROVIDER=postgres` and a secret `POSTGRES_URL`. If declaring Render Postgres in the Blueprint, use its supported `fromDatabase` connection-string reference.
3. Give the worker the same `DATABASE_PROVIDER` and `POSTGRES_URL`, using references to the API values. Keep the existing shared encryption key and other private service references.
4. Use an explicit database name. AgentZuno rejects URI query options and requires verified TLS for remote PostgreSQL hosts. The database login needs permission to create its application tables/indexes and read/write their records. See [database setup](databases.md).
5. Deploy both services and verify registration and a saved record before configuring integrations.

## Add a domain and connectors

Add your application domain to the **web** service, follow Render's DNS instructions, and wait for HTTPS. Set the API's `APP_ORIGIN` to the exact origin, such as `https://help.example.com`, without a path. The worker inherits the value. Set the web build's `PUBLIC_SITE_URL` to the same public base URL if publishing Docs from that installation, then redeploy the web service. See [Render custom domains](https://render.com/docs/custom-domains).

Update Slack, Teams, email OAuth, and identity-provider callback URLs to those displayed by the connectors after the domain change. Slack and Teams require explicit user mappings; matching email addresses do not automatically link accounts. No SSO provider is required for built-in account login. See [connections and identity](integrations.md).

## Verify and troubleshoot

| Check or symptom                 | What to inspect                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Web responds but API calls fail  | Web `API_UPSTREAM`, API logs, Atlas network rules, and database credentials                         |
| Cross-origin writes are rejected | Exact browser origin versus API/worker `APP_ORIGIN`; use the canonical HTTPS hostname               |
| Credential decryption fails      | API and worker must retain the original matching encryption key                                     |
| Chats or emails stay queued      | Worker logs and its `node src/workerHealth.js` check; queue connection and enabled provider actions |
| Knowledge indexing is pending    | Ollama model download, Qdrant disk/service availability, and worker retries                         |
| Slack or Teams receives nothing  | Public Events URL, provider installation, enabled actions, and active user mappings                 |

Verify a login, record save, chat, request submission, and workflow task. Test with a second user to confirm isolation. `/health` on the web service confirms its proxy is serving, not that every downstream service is healthy.

## Backups, upgrades, and limits

Back up the application database, encryption key, and Qdrant data as appropriate, and test restoration separately. Keep the queue persistent with `noeviction`; do not replace it with an evicting cache. Review [Render Key Value persistence](https://render.com/docs/key-value) and [persistent disk behavior](https://render.com/docs/disks).

Disk-backed services have deployment and scaling constraints. This Blueprint does not provide a fully redundant installation or a proven capacity for a particular employee count. Use [capacity testing](capacity.md), review [Render pricing](https://render.com/pricing), and include Atlas and AI usage in your budget. Choose resources from measured concurrency and knowledge volume.

Before deployment, validate the file using Render's Blueprint creation flow or the [Render CLI](https://render.com/docs/cli):

```sh
render blueprints validate render.yaml
```

These instructions describe the checked-in topology; an actual deployment still needs validation in your Render account. For other hosting choices, see [deployment and hosting](deployment.md).
