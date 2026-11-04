# Installation and development

Admins use this guide to install and configure AgentZuno. Agents handle assigned support work, Users ask for help and submit requests, and Read Only users review permitted records and reports. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

## Docker

Install [Docker with Compose](https://docs.docker.com/get-started/get-docker/), then clone the repository and create a local configuration:

```sh
git clone https://github.com/danthedevman/AgentZuno.git
cd AgentZuno
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the generated value in `CREDENTIAL_ENCRYPTION_KEY` in `.env`. Keep this key private and backed up; the API and worker need the same key to decrypt saved credentials. Do not commit `.env`.

```sh
docker compose up --build -d
```

Open [localhost:3000](http://localhost:3000) and register an account. MongoDB persists accounts and workspace records. Redis coordinates background work; the API, worker, and web run as separate services. Compose also starts Qdrant and Ollama for semantic lookup of Published authored articles and retained source imports and downloads `nomic-embed-text`.

Configure an AI provider in workspace Settings before using AI chat. Connector application credentials are entered through Connectors; SMTP and identity-provider configuration belong in Settings. Credentials are encrypted in MongoDB rather than stored as connector-specific environment variables.

Admins and Agents land on My Work. Other roles land on Chat. New workspaces start without other users' records; demo login is disabled.

## Local Node development

Use Node.js 22.12 or newer. Install dependencies and start the infrastructure:

```sh
npm ci
npm --prefix api ci
docker compose up -d mongo redis qdrant ollama
docker compose stop web api worker
```

Set the following local values in `.env`, alongside your encryption key:

```dotenv
APP_ORIGIN=http://localhost:3000
MONGODB_URI=mongodb://127.0.0.1:27017/agentzuno
REDIS_URL=redis://127.0.0.1:6379
OLLAMA_URL=http://127.0.0.1:11434
QDRANT_URL=http://127.0.0.1:6333
```

Run each process in a separate terminal:

```sh
npm run dev:api
```

```sh
npm --prefix api run worker
```

```sh
npm run dev
```

Vite serves port 3000 and proxies API requests to port 3001. Use `API_URL` to change the proxy destination and `MONGODB_DATABASE` to select a different database. The API also runs independently with `docker compose up --build api`.

## Checks

```sh
npm run format
npm run format:check
npm run build
npm run test:ui
```

Database-backed API tests use isolated databases. Start local MongoDB and Redis, then run:

```sh
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 TEST_REDIS_URL=redis://127.0.0.1:6379/15 npm --prefix api test
```

Use test services rather than production databases or Redis instances. Tests requiring these services skip when their test configuration is absent.

After registration, use the setup wizard to connect an AI provider, visit channel setup, and add knowledge. Each step and the whole wizard can be skipped. Resume configuration in Settings. When no provider is enabled, an Admin can follow the top banner directly to AI Providers.

To try fictional data, open Settings → Demo Data, choose Tech, Media, or Retail, then Load Demo Data. Explore the Catalog, My Requests, My Work, Knowledge, and Assets using normal permissions. Remove Demo Data in Settings removes the tagged dataset after confirmation, including requests made through its workflows.
