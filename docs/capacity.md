# Capacity testing

Employee count and simultaneous activity are different measurements. A company with 1,000 employees may have far fewer concurrent conversations, while an ingestion job or burst of workflow submissions can create concentrated load. The Admin, Agent, User, and Read Only roles also exercise different endpoints; see [roles and features](roles-and-features.md).

## Repeatable request-list benchmark

Start the bundled MongoDB and PostgreSQL Compose services and install root/API dependencies. Run one benchmark at a time:

```sh
node scripts/load-test.mjs mongodb 500 20
node scripts/load-test.mjs mongodb 1000 20
node scripts/load-test.mjs postgres 500 20
node scripts/load-test.mjs postgres 1000 20
```

Each run creates a disposable database with fictional employee memberships and five submitted requests per employee. It serves the real request-list API on a loopback-only temporary port, measures a single request per employee at the selected concurrency, reports throughput, errors, latency percentiles, and API heap usage, then deletes the temporary database. It never reads installation credentials or points at the live application database.

The harness uses a test-only identity fixture to select users. It exercises workspace membership and request authorization but does not measure password hashing, SSO, session storage, browser rendering, AI latency, ingestion, notifications, writes, or workflow execution. These figures cannot establish a production capacity guarantee. A local developer machine is not equivalent to a low-cost cloud server.

## PostgreSQL query improvements

The adapter pushes fixed scalar scope and common request filters into parameterized SQL, while the document evaluator still enforces the complete filter. Scope indexes now match the JSONB expressions used by the queries. Non-unique indexes requested by the app are created rather than ignored.

Complex document filters, sorting, and pagination still use the document evaluator after SQL candidate selection. Large workspaces can therefore remain expensive. Review query plans and real workload measurements before scaling; a native paginated repository for high-volume lists is the next larger optimization.

## Validate a deployment

Measure representative mixes of employee reads, agent Inbox work, approvals, workflow runs, AI chats, and imports on the intended host. Use fictional or properly sanitized staging data. Monitor API and worker memory, CPU, database latency/connections, Redis queue depth and retries, model response times, and failures. Decide acceptable latency/error thresholds before running a test and include a sustained soak plus a burst, rather than relying on one short result.

Check backup restoration and upgrade rehearsal using [recovery](recovery.md). Do not roll out to all employees solely because the request-list benchmark passes.
