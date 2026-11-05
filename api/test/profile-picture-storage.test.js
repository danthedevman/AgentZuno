import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import { BSON, Binary, MongoClient, ObjectId } from 'mongodb';
import pg from 'pg';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { installProfilePictureRoutes } from '../src/profilePictures.js';
import { storedBinaryBytes } from '../src/storedBinary.js';

async function verifyPictures(database) {
  const user = { id: 'owner', workspaceId: 'workspace', role: 'user' };
  await database.collection('users').insertOne({ ...user, name: 'Owner' });
  await database
    .collection('helpdeskMembers')
    .insertOne({ ownerId: user.id, workspaceId: user.workspaceId, userId: user.id, active: true });
  const app = express();
  app.use(express.raw({ type: 'image/png', limit: '5mb' }));
  app.use(express.json());
  app.use((request, response, next) => {
    request.helpdeskUser = user;
    next();
  });
  installProfilePictureRoutes(app, database);
  app.use((error, request, response, next) =>
    response.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#818cf8' },
    })
      .png()
      .toBuffer();
    assert.equal(
      (
        await fetch(root + '/api/helpdesk/profile-picture', {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: png,
        })
      ).status,
      200,
    );
    const saved = await database.collection('profilePictures').findOne({ _id: user.id });
    assert.ok(saved.bytes instanceof Binary);
    const picture = await (await fetch(root + '/api/helpdesk/profile-pictures/owner')).json();
    const bytes = Buffer.from(picture.image.split(',')[1], 'base64');
    assert.equal((await sharp(bytes).metadata()).format, 'webp');
    assert.equal(
      (await database.collection('users').findOne({ id: user.id })).profilePictureVersion,
      1,
    );
    const legacy = BSON.EJSON.deserialize(BSON.EJSON.serialize(bytes));
    await database
      .collection('profilePictures')
      .updateOne({ _id: user.id }, { $set: { bytes: legacy } });
    const recovered = await (await fetch(root + '/api/helpdesk/profile-pictures/owner')).json();
    assert.equal(recovered.image, picture.image);
    assert.deepEqual(storedBinaryBytes(bytes.subarray(1, 5)), bytes.subarray(1, 5));
    await database
      .collection('profilePictures')
      .insertOne({ _id: 'other', bytes: new Binary(bytes), type: 'image/webp' });
    async function remove(body) {
      return fetch(root + '/api/helpdesk/profile-picture', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    for (const input of [
      {},
      { confirmed: false },
      { confirmed: true, userId: 'other' },
      { confirmed: { $ne: false } },
    ])
      assert.equal((await remove(input)).status, 400);
    user.role = 'read-only';
    assert.equal((await remove({ confirmed: true })).status, 403);
    user.role = 'user';
    assert.equal((await remove({ confirmed: true })).status, 200);
    assert.equal(await database.collection('profilePictures').findOne({ _id: 'owner' }), null);
    assert.ok(await database.collection('profilePictures').findOne({ _id: 'other' }));
    assert.equal(
      (await (await fetch(root + '/api/helpdesk/profile-pictures/owner')).json()).image,
      null,
    );
    assert.equal(
      (await database.collection('users').findOne({ id: 'owner' })).profilePictureVersion,
      2,
    );
    assert.equal((await (await remove({ confirmed: true })).json()).removed, false);
    assert.equal(
      (await database.collection('users').findOne({ id: 'owner' })).profilePictureVersion,
      2,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
test('profile pictures decode, recover legacy bytes and remove only the current user photo', () =>
  verifyPictures(createMemoryDatabase()));
test(
  'profile photo removal works with MongoDB',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    const database = client.db('az_picture_remove_' + new ObjectId());
    try {
      await verifyPictures(database);
    } finally {
      await database.dropDatabase();
      await client.close();
    }
  },
);
test(
  'profile photo removal works with PostgreSQL',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const connection = postgresConnection(process.env.TEST_POSTGRES_URL);
    const admin = new pg.Pool(connection);
    const name = 'az_picture_remove_' + new ObjectId();
    await admin.query(`CREATE DATABASE ${name}`);
    const database = createPostgresDatabase({ ...connection, database: name });
    try {
      await verifyPictures(database);
    } finally {
      await database.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  },
);
