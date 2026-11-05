import { performance } from 'node:perf_hooks';
import { ObjectId, MongoClient } from '../api/node_modules/mongodb/lib/index.js';
import pg from '../api/node_modules/pg/lib/index.js';
import { createApi } from '../api/src/app.js';
import { createPostgresDatabase } from '../api/src/storage/postgres.js';

const provider = process.argv[2] || 'mongodb';
const users = Number(process.argv[3] || 500),
  concurrency = Number(process.argv[4] || 20);
if (
  !['mongodb', 'postgres'].includes(provider) ||
  ![500, 1000].includes(users) ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 50
)
  throw new Error('Usage: node scripts/load-test.mjs mongodb|postgres 500|1000 [concurrency 1–50]');
// Never read installation credentials or reuse the application database.
const name = 'az_load_' + new ObjectId().toHexString();
let database, mongo, admin, app, server;
const samples = [];
let failures = 0,
  completed = 0;
const employeeIds = Array.from({ length: users }, () => new ObjectId().toHexString());
const ownerId = employeeIds[0],
  workspaceId = new ObjectId().toHexString();
const scope = { ownerId, workspaceId };
try {
  if (provider === 'mongodb') {
    mongo = new MongoClient('mongodb://127.0.0.1:' + (process.env.MONGO_PORT || 27017));
    database = mongo.db(name);
  } else {
    const connection = {
      host: '127.0.0.1',
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: 'agentzuno',
      password: process.env.POSTGRES_PASSWORD || 'agentzuno-local-only',
    };
    admin = new pg.Pool({ ...connection, database: 'postgres' });
    await admin.query(`CREATE DATABASE ${name}`);
    database = createPostgresDatabase({ ...connection, database: name });
  }
  await database.collection('users').insertMany(
    employeeIds.map((id, index) => ({
      id,
      workspaceId: index ? new ObjectId().toHexString() : workspaceId,
      name: `Employee ${index}`,
      email: `employee-${index}@example.test`,
    })),
  );
  await database.collection('helpdeskMembers').insertMany(
    employeeIds.map((userId, index) => ({
      ...scope,
      userId,
      email: `employee-${index}@example.test`,
      role: index ? 'user' : 'admin',
      active: true,
      queues: [],
      version: 1,
    })),
  );
  await database.collection('helpdeskRequests').insertMany(
    employeeIds.flatMap((requesterId, employee) =>
      Array.from({ length: 5 }, (_, index) => ({
        _id: new ObjectId(),
        ...scope,
        requesterId,
        requestId: new ObjectId().toHexString(),
          number: `REQ-${employee}-${index}`,
        title: `Employee ${employee} request ${index}`,
        description: 'Fictional load-test request',
        submissionState: 'submitted',
        channel: 'web',
        status: index % 2 ? 'resolved' : 'open',
        queueName: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      })),
    ),
  );
  const auth = {
    currentUser: async (request) => {
      const id = request.headers.cookie?.match(/load_user=([a-f0-9]{24})/)?.[1];
      return id && employeeIds.includes(id) ? database.collection('users').findOne({ id }) : null;
    },
    accounts: { findById: (id) => database.collection('users').findOne({ id }) },
    close: async () => {},
    login: (_, response) => response.sendStatus(403),
    register: (_, response) => response.sendStatus(403),
    logout: (_, response) => response.json({ user: null }),
  };
  const queues = {
    chat: async () => {},
    workflow: async () => {},
    sync: async () => {},
    slack: async () => {},
    email: async () => {},
    close: async () => {},
  };
  app = createApi({ database, auth, queues });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = async (employee) => {
    const started = performance.now();
    const response = await fetch(origin + '/api/helpdesk/requests?list=1&pageSize=20', {
      headers: { cookie: `load_user=${employeeIds[employee]}`, 'X-Workspace-Id': workspaceId },
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    if (
      !response.ok ||
      !Array.isArray(body.rows) ||
      (employee &&
        body.rows.some((row) => row.requesterId && row.requesterId !== employeeIds[employee]))
    )
      failures++;
    samples.push(performance.now() - started);
  };
  // Warm startup indexes before measuring ordinary reads.
  await run(1);
  samples.length = 0;
  failures = 0;
  let next = 1;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < users) {
        const employee = next++;
        try {
          await run(employee);
        } catch {
          failures++;
        }
        completed++;
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  samples.sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] || 0);
  console.log(
    JSON.stringify(
      {
        provider,
        employees: users,
        records: users * 5,
        concurrency,
        requests: completed,
        failures,
        seconds: Number(elapsed.toFixed(2)),
        requestsPerSecond: Number((completed / elapsed).toFixed(1)),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
        apiHeapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        scope:
          'Local authenticated request-list reads using a test-only identity fixture; excludes AI, SSO, writes, ingestion and browser rendering',
      },
      null,
      2,
    ),
  );
  if (failures) process.exitCode = 1;
} finally {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  await app?.locals.close();
  if (mongo) {
    await mongo.db(name).dropDatabase();
    await mongo.close();
  }
  if (admin) {
    await database?.close();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}
