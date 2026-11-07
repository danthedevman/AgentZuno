import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createAccountStore } from '../src/identity/accountStore.js';
import { createAuth } from '../src/identity/auth.js';
import { recoverLocalAccount } from '../src/identity/localRecovery.js';

function response() {
  return {
    code: 200,
    cookie(name, token) {
      this.token = token;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}
async function verify(db) {
  const accounts = createAccountStore(undefined, db);
  const store = createIntegrationStore(db);
  const auth = createAuth(accounts);
  const oldPassword = 'fictional-old-password';
  const newPassword = 'fictional-new-password';
  const user = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    email: 'owner@example.test',
    name: 'Owner',
    salt: 'fictional-salt',
    passwordHash: scryptSync(oldPassword, 'fictional-salt', 64).toString('hex'),
  };
  await accounts.createUser(user);
  const other = {
    ...user,
    _id: new ObjectId(),
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    email: 'other@example.test',
  };
  await accounts.createUser(other);
  const identity = {
    ...user,
    _id: new ObjectId(),
    id: String(new ObjectId()),
    email: 'identity@example.test',
    identityOnly: true,
  };
  await accounts.createUser(identity);
  const first = response();
  await auth.startSession({ headers: {} }, first, user);
  const untouched = response();
  await auth.startSession({ headers: {} }, untouched, other);
  const request = (token) => ({ headers: { cookie: `agentzuno_session=${token}` } });
  assert.equal((await auth.currentUser(request(first.token))).id, user.id);
  for (const invalid of [{ $ne: null }, ['owner@example.test'], null]) {
    await assert.rejects(recoverLocalAccount(store, invalid, newPassword));
    await assert.rejects(accounts.findUser(invalid));
    await assert.rejects(accounts.findById(invalid));
  }
  await assert.rejects(recoverLocalAccount(store, user.email, { $ne: null }));
  await assert.rejects(recoverLocalAccount(store, user.email, 'short'));
  await assert.rejects(recoverLocalAccount(store, identity.email, newPassword));
  await assert.rejects(recoverLocalAccount(store, 'missing@example.test', newPassword));
  await recoverLocalAccount(store, user.email.toUpperCase(), newPassword);
  assert.equal(await auth.currentUser(request(first.token)), null);
  assert.equal((await auth.currentUser(request(untouched.token))).id, other.id);
  const stale = response();
  await auth.startSession({ headers: {} }, stale, user);
  assert.equal(
    await auth.currentUser(request(stale.token)),
    null,
    'in-flight old-password login stays invalid',
  );
  const denied = response();
  await auth.login({ headers: {}, body: { email: user.email, password: oldPassword } }, denied);
  assert.equal(denied.code, 401);
  const accepted = response();
  await auth.login({ headers: {}, body: { email: user.email, password: newPassword } }, accepted);
  assert.equal(accepted.code, 200);
  assert.equal((await auth.currentUser(request(accepted.token))).id, user.id);
  assert.equal((await accounts.findById(other.id)).passwordHash, other.passwordHash);
  const changed = await accounts.findById(user.id);
  assert.notEqual(changed.salt, user.salt);
  const audit = await store
    .collection('governanceAudit')
    .find({ action: 'auth.local-recovery' })
    .toArray();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].outcome, 'completed');
  const allAudits = JSON.stringify(await store.collection('governanceAudit').find({}).toArray());
  for (const secret of [
    oldPassword,
    newPassword,
    changed.passwordHash,
    changed.salt,
    changed.sessionVersion,
    accepted.token,
  ])
    assert.equal(allAudits.includes(secret), false);
}
test('local recovery revokes sessions without changing other accounts', () =>
  verify(createMemoryDatabase()));
test('local recovery on MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI),
    db = client.db('az_recovery_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test('local recovery on PostgreSQL', { skip: !process.env.TEST_POSTGRES_URL }, async () => {
  const config = postgresConnection(process.env.TEST_POSTGRES_URL),
    admin = new pg.Pool(config),
    name = 'az_recovery_' + new ObjectId();
  await admin.query(`CREATE DATABASE ${name}`);
  const db = createPostgresDatabase({ ...config, database: name });
  try {
    await verify(db);
  } finally {
    await db.close();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
});
