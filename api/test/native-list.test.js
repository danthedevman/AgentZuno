import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { databasePage } from '../src/databasePage.js';

async function verify(database) {
  const store = { collection: (name) => database.collection(name) };
  const ownerId = 'owner',
    workspaceId = 'workspace';
  const scope = { ownerId, workspaceId };
  const ids = Array.from({ length: 4 }, () => new ObjectId());
  await database.collection('requests').insertMany([
    {
      _id: ids[0],
      ...scope,
      title: 'Laptop 10',
      status: 'open',
      updatedAt: new Date('2026-01-01'),
    },
    {
      _id: ids[1],
      ...scope,
      title: 'laptop 2',
      status: 'waiting-for-employee',
      updatedAt: new Date('2026-01-02'),
    },
    { _id: ids[2], ...scope, title: 'Café', status: 'open', updatedAt: new Date('2026-01-03') },
    {
      _id: ids[3],
      ...scope,
      workspaceId: 'other',
      title: 'Private',
      updatedAt: new Date('2026-01-04'),
    },
  ]);
  const options = { page: 1, pageSize: 1, sortField: 'title', sortType: 'text', direction: 'asc' };
  const first = await databasePage(store, [{ name: 'requests', filter: scope }], options);
  assert.equal(first.total, 3);
  assert.equal(first.rows[0].title, 'Café');
  const second = await databasePage(store, [{ name: 'requests', filter: scope }], {
    ...options,
    page: 2,
  });
  assert.equal(second.rows[0].title, 'laptop 2');
  const filtered = await databasePage(
    store,
    [
      {
        name: 'requests',
        filter: { $and: [scope, { $or: [{ title: { $regex: 'laptop', $options: 'i' } }] }] },
      },
    ],
    { ...options, pageSize: 20, sortField: 'updatedAt', sortType: 'date', direction: 'desc' },
  );
  assert.deepEqual(
    filtered.rows.map((row) => row.title),
    ['laptop 2', 'Laptop 10'],
  );
  const missing = await databasePage(
    store,
    [{ name: 'requests', filter: { ...scope, title: { $regex: "x' OR TRUE --", $options: 'i' } } }],
    options,
  );
  assert.equal(missing.total, 0);
  const archived = await databasePage(
    store,
    [{ name: 'requests', filter: { ...scope, _id: { $in: [ids[0]] } } }],
    options,
  );
  assert.equal(archived.total, 1);
  await database.collection('tasks').insertOne({
    _id: new ObjectId(),
    ...scope,
    title: 'Laptop 3',
    status: 'open',
    updatedAt: new Date('2026-01-05'),
  });
  const combined = await databasePage(
    store,
    [
      { name: 'requests', filter: scope },
      { name: 'tasks', kind: 'task', filter: scope },
    ],
    { ...options, pageSize: 20 },
  );
  assert.deepEqual(
    combined.rows.map((row) => row.title),
    ['Café', 'laptop 2', 'Laptop 3', 'Laptop 10'],
  );
  assert.equal(combined.rows[2].kind, 'task');
  const last = await databasePage(store, [{ name: 'requests', filter: scope }], {
    ...options,
    page: 100,
  });
  assert.equal(last.page, 3);
  assert.equal(last.rows[0].title, 'Laptop 10');
}
test(
  'native list search, numeric sorting, counts, unions, pagination and scope match on MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI),
      db = client.db('az_native_' + new ObjectId());
    try {
      await verify(db);
    } finally {
      await db.dropDatabase();
      await client.close();
    }
  },
);
test(
  'native list search, numeric sorting, counts, unions, pagination and scope match on PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(connection),
      name = 'az_native_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const db = createPostgresDatabase({ ...connection, database: name });
    try {
      await verify(db);
    } finally {
      await db.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
