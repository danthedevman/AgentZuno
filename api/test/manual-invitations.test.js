import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ObjectId, MongoClient } from 'mongodb';
import pg from 'pg';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createInvitationsController } from '../src/controllers/identity/invitationsController.js';
import { createHelpdeskRolesController } from '../src/controllers/identity/helpdeskRolesController.js';
import { encryptSecret } from '../src/shared/secrets.js';
import { createInvitationDelivery, hash } from '../src/identity/invitations.js';

async function verify(db) {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const store = { collection: db.collection.bind(db) };
  const controller = createInvitationsController(store);
  const admin = { id: String(new ObjectId()), workspaceId: String(new ObjectId()), role: 'admin' };
  const input = {
    email: 'invitee@fixture.test',
    role: 'user',
    queues: [],
    canApprove: false,
    active: true,
  };
  let result;
  const response = {
    status(code) {
      assert.equal(code, 202);
      return this;
    },
    json(value) {
      result = value;
    },
  };
  await assert.rejects(
    controller.postInvitations({ helpdeskUser: { ...admin, role: 'user' }, body: input }, response),
    { status: 403 },
  );
  await assert.rejects(
    controller.postInvitations(
      { helpdeskUser: admin, body: { ...input, email: { $ne: null } } },
      response,
    ),
    { status: 400 },
  );
  await controller.postInvitations({ helpdeskUser: admin, body: input }, response);
  assert.equal(result.delivery, 'manual');
  const url = new URL(result.invitationUrl);
  const token = url.hash.slice(1);
  assert.match(token, /^[a-f0-9]{64}$/);
  const record = await db.collection('workspaceInvitations').findOne({ tokenHash: hash(token) });
  assert.equal(record.message, undefined);
  assert.ok(!JSON.stringify(record).includes(token));
  assert.equal(await db.collection('users').countDocuments({}), 0);
  let sends = 0;
  await createInvitationDelivery(store, async () => {
    sends++;
  })();
  assert.equal(sends, 0);
  await assert.rejects(controller.postInvitations({ helpdeskUser: admin, body: input }, response), {
    status: 409,
  });
  let listing;
  await controller.getInvitations(
    { helpdeskUser: admin, query: {} },
    {
      json(value) {
        listing = value;
      },
    },
  );
  assert.ok(!JSON.stringify(listing).includes(token));
  await assert.rejects(
    controller.postInvitationsAccept(
      { user: { id: String(new ObjectId()), email: 'wrong@fixture.test' }, body: { token } },
      response,
    ),
    { status: 403 },
  );
  await db
    .collection('helpdeskMembers')
    .insertOne({ workspaceId: admin.workspaceId, userId: admin.id, role: 'admin', active: true });
  const originalId = String(record._id);
  const resendRequest = {
    helpdeskUser: admin,
    params: { id: originalId },
    body: { mode: 'link', version: 1 },
  };
  await assert.rejects(
    controller.postInvitationResend(
      { ...resendRequest, helpdeskUser: { ...admin, role: 'user' } },
      response,
    ),
    { status: 403 },
  );
  await assert.rejects(
    controller.postInvitationResend(
      { ...resendRequest, helpdeskUser: { ...admin, workspaceId: String(new ObjectId()) } },
      response,
    ),
    { status: 404 },
  );
  await assert.rejects(
    controller.postInvitationResend(
      { ...resendRequest, body: { mode: 'link', version: { $ne: null } } },
      response,
    ),
    { status: 400 },
  );
  await assert.rejects(
    controller.postInvitationResend(
      { ...resendRequest, body: { mode: 'email', version: 1 } },
      response,
    ),
    { status: 409 },
  );
  await controller.postInvitationResend(resendRequest, response);
  const replacementToken = new URL(result.invitationUrl).hash.slice(1);
  assert.notEqual(replacementToken, token);
  await assert.rejects(controller.postInvitationResend(resendRequest, response), { status: 409 });
  await assert.rejects(
    controller.postInvitationsAccept(
      { user: { id: String(new ObjectId()), email: input.email }, body: { token } },
      response,
    ),
    { status: 403 },
  );
  const deletion = {
    helpdeskUser: admin,
    params: { id: originalId },
    body: { confirmed: true, version: 2 },
  };
  await assert.rejects(
    controller.deleteInvitation({ ...deletion, body: { version: 2 } }, response),
    { status: 400 },
  );
  await assert.rejects(
    controller.deleteInvitation({ ...deletion, params: { id: { $ne: null } } }, response),
    { status: 400 },
  );
  await controller.deleteInvitation(deletion, {
    json(value) {
      assert.equal(value.removed, true);
    },
  });
  await assert.rejects(
    controller.postInvitationsAccept(
      {
        user: { id: String(new ObjectId()), email: input.email },
        body: { token: replacementToken },
      },
      response,
    ),
    { status: 403 },
  );
  await controller.getInvitations(
    { helpdeskUser: admin, query: {} },
    {
      json(value) {
        listing = value;
      },
    },
  );
  assert.ok(!JSON.stringify(listing).includes(originalId));
  await controller.postInvitations({ helpdeskUser: admin, body: input }, response);
  const acceptedToken = new URL(result.invitationUrl).hash.slice(1);
  const recipient = { id: String(new ObjectId()), email: input.email };
  let accepted;
  await controller.postInvitationsAccept(
    { user: recipient, body: { token: acceptedToken } },
    {
      json(value) {
        accepted = value;
      },
    },
  );
  assert.equal(accepted.workspaceId, admin.workspaceId);
  assert.equal(
    (await db.collection('helpdeskMembers').findOne({ userId: recipient.id })).role,
    'user',
  );
  const roles = createHelpdeskRolesController(store);
  const removal = {
    helpdeskUser: admin,
    params: { id: recipient.id },
    body: { confirmed: true, version: 1 },
  };
  await assert.rejects(roles.deleteMembersId({ ...removal, body: { version: 1 } }, response), {
    status: 400,
  });
  await assert.rejects(roles.deleteMembersId({ ...removal, params: { id: admin.id } }, response), {
    status: 409,
  });
  await assert.rejects(
    roles.deleteMembersId({ ...removal, params: { id: { $ne: null } } }, response),
    { status: 400 },
  );
  await assert.rejects(
    roles.deleteMembersId({ ...removal, body: { confirmed: true, version: 2 } }, response),
    { status: 409 },
  );
  await roles.deleteMembersId(removal, {
    json(value) {
      assert.equal(value.removed, true);
    },
  });
  assert.equal(await db.collection('helpdeskMembers').countDocuments({ userId: recipient.id }), 0);
  assert.equal(
    await db
      .collection('helpdeskMembershipHistory')
      .countDocuments({ targetUserId: recipient.id, action: 'removed' }),
    1,
  );
  await controller.postInvitations(
    { helpdeskUser: admin, body: { ...input, email: 'email@fixture.test' } },
    response,
  );
  const emailId = result.id;
  await db.collection('smtpSettings').insertOne({
    ownerId: admin.id,
    workspaceId: admin.workspaceId,
    credential: encryptSecret(JSON.stringify({ from: 'fixture@example.test' })),
  });
  await controller.postInvitationResend(
    { helpdeskUser: admin, params: { id: emailId }, body: { mode: 'email', version: 1 } },
    response,
  );
  assert.equal(result.delivery, 'queued');
  assert.equal(result.invitationUrl, undefined);
  await createInvitationDelivery(store, async (message) => {
    assert.equal(message.to, 'email@fixture.test');
    assert.match(message.text, /invite#/);
    sends++;
  })();
  assert.equal(sends, 1);
  await db
    .collection('identitySettings')
    .insertOne({ ownerId: admin.id, workspaceId: admin.workspaceId, enabled: true });
  await assert.rejects(
    controller.postInvitations(
      { helpdeskUser: admin, body: { ...input, email: 'other@fixture.test' } },
      response,
    ),
    { status: 409 },
  );
}
test('manual invitations require Admin, keep tokens private, and bind acceptance to the invited email', () =>
  verify(createMemoryDatabase()));
test('manual invitations work with MongoDB', { skip: !process.env.TEST_MONGODB_URI }, async () => {
  const client = new MongoClient(process.env.TEST_MONGODB_URI);
  await client.connect();
  const db = client.db('az_manual_invites_' + new ObjectId());
  try {
    await verify(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
test(
  'manual invitations work with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL),
      admin = new pg.Pool(connection),
      name = 'az_manual_invites_' + new ObjectId();
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
