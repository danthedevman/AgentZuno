# Database setup

This guide is for Admins configuring the installation or its connections. Agents and Users use the published features their permissions allow; Read Only users inspect permitted records without changing configuration. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

AgentZuno can use MongoDB or PostgreSQL for the entire installation. Accounts, sessions, workspaces, permissions, articles, binary uploads, workflows, requests, tasks, connector configuration and governance records all use the selected adapter. Redis remains the job queue; Qdrant remains the vector index; Ollama provides local embeddings. Choosing PostgreSQL does not remove these services.

## First installation

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Docker Engine](https://docs.docker.com/engine/install/) with [Docker Compose](https://docs.docker.com/compose/install/).
2. Run `docker compose up --build -d`. Compose provides both database services so either is ready to select. Only the selected engine stores application records.
3. Open the web app and click Get Access. Before registration, the database wizard opens at `/setup/database`.
4. Retrieve the server's setup token with `docker compose exec api cat /app/installation/setup.token`. Copy it into Setup Token. For local Node development, read `api/.installation/setup.token` instead. Keep this token private: it authorizes installation-wide database configuration.
5. Choose MongoDB or PostgreSQL, then Use Bundled Database or Use My Own Connection.
6. Select Connect and Continue. The server verifies connectivity and read/write access before saving the selection. Failed validation leaves setup incomplete and does not create a user.
7. Register with your name, email and password. The account and session are written directly to the selected database. Continue with AI provider, connectors and knowledge setup. Those workspace setup steps can be skipped; database initialization is required first.

There is no temporary account database and no per-workspace database selector. Every account's personal workspace and any workspaces it joins live in the installation's selected database. Database access does not replace workspace authorization: server-side scope and role checks apply with either adapter.

## Bundled databases

MongoDB uses the `mongo-data` volume. PostgreSQL uses the `postgres-data` volume. Installation configuration uses a separate `installation-data` volume shared by the API and worker. Keep all relevant volumes when upgrading.

The bundled PostgreSQL database/user are `agentzuno`. Its local development password defaults to `agentzuno-local-only`. Set `POSTGRES_PASSWORD` to a strong secret **before initializing the PostgreSQL volume** for a real deployment. Changing this variable after initialization does not rotate an existing database password; use PostgreSQL's supported password management procedures. Host database ports bind to loopback in Compose; restrict container-network access and production exposure separately.

Unused database containers can be stopped after setup: `docker compose stop mongo` when using PostgreSQL, or `docker compose stop postgres` when using MongoDB. The default Compose dependencies start both again during a full `up`; do not delete a volume to disable a service. This bundled arrangement favors a simple installer over the smallest possible infrastructure footprint.

## Bring your own MongoDB

Use a dedicated database and a least-privilege account with read/write and index-creation permissions. Supported URI schemes are `mongodb://` and `mongodb+srv://`. Include the database name, for example:

```text
mongodb+srv://USERNAME:PASSWORD@CLUSTER/agentzuno
```

Percent-encode reserved characters in credentials. Use verified TLS for remote production databases, restrict network access to the API/worker, and never paste real credentials into documentation, chat, Git or screenshots. See the official [MongoDB connection string guide](https://www.mongodb.com/docs/manual/reference/connection-string/) and [MongoDB Atlas setup guide](https://www.mongodb.com/docs/atlas/getting-started/).

## Bring your own PostgreSQL

Create a dedicated database and a login that can connect, create tables and indexes, and read/write/delete records in its schema. PostgreSQL is not automatically provisioned on an external server. Example:

```text
postgresql://USERNAME:PASSWORD@HOST:5432/agentzuno
```

The wizard accepts a connection URI with an explicit database name. Query-string options are rejected; remote hosts require TLS with certificate verification. Bundled `postgres`, localhost and loopback addresses use the local non-TLS connection. Configure trusted server certificates rather than disabling verification. Unix sockets, arbitrary driver options and custom certificate upload are not currently exposed in the wizard.

Read the official [PostgreSQL downloads](https://www.postgresql.org/download/), [database creation](https://www.postgresql.org/docs/current/manage-ag-createdb.html), [connection security](https://www.postgresql.org/docs/current/libpq-ssl.html), and [node-postgres connection documentation](https://node-postgres.com/features/connecting).

## How the adapters store data

MongoDB uses the official Node.js driver and native collections. PostgreSQL uses [node-postgres](https://node-postgres.com/) and collection-specific JSONB tables with stable, generated physical names. BSON-compatible identifiers, dates and binary values are encoded in extended JSON so existing records have the same application shape on both engines. Each table has a primary-key constraint and workspace/owner index; declared unique indexes become PostgreSQL unique indexes.

The PostgreSQL adapter preserves the existing document-oriented application contract. It does **not** convert the entire domain into normalized relational tables or add relational foreign keys to every reference. ID/scope predicates are pushed into SQL, while nested document filters, projections, sorting and reporting expressions use the shared [Mingo query evaluator](https://github.com/kofrasa/mingo) on the API/worker. Filtering and pagination remain server-side. Large matching datasets can consume API memory; benchmark realistic data before production adoption. A future normalized schema would be a separate change.

Writes use PostgreSQL transactions and collection-local advisory locks so concurrent version checks, leases, single-use claims and upserts do not race across API and worker processes. Expiring documents are swept periodically; authorization still checks expiration timestamps directly. Redis delivery remains at-least-once with durable application state and idempotency checks; choosing PostgreSQL does not create a distributed exactly-once guarantee.

## Configuration and secrets

The installation directory contains `database.json`, `installation.key` and `setup.token`. Connection details in `database.json` are encrypted with AES-256-GCM using the installation key; files are created with owner-only permissions. The key is stored separately in the same protected volume, so encryption does not protect against someone who can read the entire volume or control the host. Protect and back up that volume as a secret. The public setup API returns only setup state and provider metadata, never the connection URI or password.

Setup is a one-time operation guarded by the server-generated token, same-origin write checks and rate limiting. Once configured, the setup endpoint refuses connection changes. The worker waits for the shared configuration and then connects to the same engine. No container restart is required after completing the wizard.

## Existing installations and environment-managed deployment

An existing installation should select its current MongoDB connection to retain existing data. Selecting an empty PostgreSQL database does not migrate MongoDB records. Do not use this wizard as a migration tool or delete configuration to switch a populated installation.

Deployments that manage configuration outside the web wizard can set `DATABASE_SETUP_MODE=environment`. Set `DATABASE_PROVIDER=postgres` and `POSTGRES_URL` for PostgreSQL, or supply `MONGODB_URI` and optional `MONGODB_DATABASE` for MongoDB. API and worker must receive the same values. The existing Render launcher uses environment-managed configuration because separate Render services do not share a local configuration volume. Keep connection strings in the hosting platform's secret store.

Local Node startup enables the protected `api/.installation` directory by default. Run the API and worker from the same project checkout so they share it. This directory is ignored by Git. Tests configure their own databases and do not use the interactive installer.

## Backups, restoration and switching engines

Back up the selected database, installation configuration/key, provider encryption key, Redis and any required vector indexes. Use [mongodump/mongorestore](https://www.mongodb.com/docs/database-tools/mongodump/) for MongoDB or [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) and [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html) for PostgreSQL. Test restoration in an isolated environment and preserve the encryption keys needed to recover connector secrets.

No automatic MongoDB-to-PostgreSQL or reverse migration is included. Switching an installation with data requires a planned export/import, ID/type preservation, attachment verification, authorization checks, index rebuilding and downtime/rollback procedures. A database backup is not interchangeable between engines. Never change the connection while jobs are actively writing.

## Workflow lookups

Workflow forms support `reference` fields with `referenceTable` set to `users` or an existing built-in/custom Data table ID. Admin chat receives available table IDs/names and the form editor offers the same choices. Publishing the field grants permitted workflow users the ability to search labels and select IDs from that table; it does not grant full record access. Request/task references are limited to records the current user can read. Lookups are workspace-scoped, exclude demo records in real workflows, and revalidate selections on submission. Requests retain the selected ID, table and display label. These rules apply with either database adapter.
