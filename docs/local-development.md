# Local development

For developers changing AgentZuno itself. To install and use the app, follow [Getting Started](getting-started.md).

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
