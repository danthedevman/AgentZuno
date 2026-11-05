import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import { BSON, Binary } from 'mongodb';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { installProfilePictureRoutes } from '../src/profilePictures.js';
import { storedBinaryBytes } from '../src/storedBinary.js';

test('profile pictures survive JSONB serialization and legacy numbered-byte pictures remain readable', async () => {
  const database = createMemoryDatabase();
  const user = { id: 'owner', workspaceId: 'workspace' };
  await database.collection('users').insertOne({ ...user, name: 'Owner' });
  await database
    .collection('helpdeskMembers')
    .insertOne({ ownerId: user.id, workspaceId: user.workspaceId, userId: user.id, active: true });
  const app = express();
  app.use(express.raw({ type: 'image/png', limit: '5mb' }));
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
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
