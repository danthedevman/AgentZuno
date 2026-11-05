import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { MongoClient, ObjectId, Binary } from '../api/node_modules/mongodb/lib/index.js';
import pg from '../api/node_modules/pg/lib/index.js';
import { createPostgresDatabase } from '../api/src/storage/postgres.js';
import { createIntegrationStore } from '../api/src/integrationStore.js';

// Restore drills only touch random, disposable databases in the bundled Compose services.
function compose(service, command, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', 'exec', '-T', service, ...command], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`${service} recovery tool failed (${code}).`)),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const suffix = new ObjectId().toHexString();
const sourceName = `az_recovery_source_${suffix}`;
const targetName = `az_recovery_target_${suffix}`;
const ownerId = new ObjectId().toHexString(),
  workspaceId = new ObjectId().toHexString();
const scope = { ownerId, workspaceId };
const fixture = {
  users: {
    _id: new ObjectId(),
    id: ownerId,
    workspaceId,
    name: 'Recovery Test',
    email: 'restore@example.test',
    passwordHash: 'fictional-hash',
  },
  helpdeskMembers: {
    _id: new ObjectId(),
    ...scope,
    userId: ownerId,
    role: 'admin',
    active: true,
    queues: [],
    version: 1,
  },
  helpdeskRequests: {
    _id: new ObjectId(),
    ...scope,
    requesterId: ownerId,
    title: 'Restore drill',
    status: 'open',
    submissionState: 'submitted',
    version: 1,
    createdAt: new Date(),
  },
  profilePictures: {
    _id: ownerId,
    bytes: new Binary(Buffer.from('fictional-image-bytes')),
    contentType: 'image/png',
  },
  governanceAudit: {
    _id: new ObjectId(),
    ...scope,
    action: 'restore-fixture',
    outcome: 'completed',
    at: new Date(),
  },
};
async function seed(database) {
  for (const [name, record] of Object.entries(fixture))
    await database.collection(name).insertOne(record);
}
async function verify(database) {
  // Current startup/index initialization must accept a restored previous-format fixture.
  const store = createIntegrationStore(database);
  await store.ready();
  for (const [name, expected] of Object.entries(fixture)) {
    const actual = await database.collection(name).findOne({ _id: expected._id });
    assert.ok(actual, `${name} restored`);
    if (name === 'profilePictures')
      assert.equal(Buffer.from(actual.bytes.buffer).toString(), 'fictional-image-bytes');
    else assert.equal(actual.workspaceId, workspaceId);
  }
  assert.equal(
    await database.collection('helpdeskRequests').countDocuments({ ...scope, version: 1 }),
    1,
  );
  assert.equal(
    await database
      .collection('helpdeskRequests')
      .countDocuments({ ...scope, workspaceId: new ObjectId().toHexString() }),
    0,
  );
  await store.close();
}
const mongo = new MongoClient('mongodb://127.0.0.1:' + (process.env.MONGO_PORT || '27017'));
try {
  await seed(mongo.db(sourceName));
  const archive = await compose('mongo', ['mongodump', '--db', sourceName, '--archive']);
  await compose(
    'mongo',
    ['mongorestore', '--archive', '--nsFrom', `${sourceName}.*`, '--nsTo', `${targetName}.*`],
    archive,
  );
  await verify(mongo.db(targetName));
  console.log(
    'MongoDB native backup, isolated restore, binary data and startup compatibility: passed',
  );
} finally {
  await mongo.db(sourceName).dropDatabase();
  await mongo.db(targetName).dropDatabase();
  await mongo.close();
}
const connection = {
  host: '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: 'agentzuno',
  password: process.env.POSTGRES_PASSWORD || 'agentzuno-local-only',
  database: 'postgres',
};
const admin = new pg.Pool(connection);
let source, target;
try {
  await admin.query(`CREATE DATABASE ${sourceName}`);
  await admin.query(`CREATE DATABASE ${targetName}`);
  source = createPostgresDatabase({ ...connection, database: sourceName });
  await seed(source);
  await source.close();
  source = null;
  const archive = await compose('postgres', [
    'pg_dump',
    '-U',
    'agentzuno',
    '-Fc',
    '-d',
    sourceName,
  ]);
  await compose(
    'postgres',
    ['pg_restore', '-U', 'agentzuno', '-d', targetName, '--no-owner', '--no-privileges'],
    archive,
  );
  target = createPostgresDatabase({ ...connection, database: targetName });
  await verify(target);
  console.log(
    'PostgreSQL native backup, isolated restore, binary data and startup compatibility: passed',
  );
} finally {
  await source?.close();
  await target?.close();
  await admin.query(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`);
  await admin.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`);
  await admin.end();
}
