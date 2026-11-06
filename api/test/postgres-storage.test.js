import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { ObjectId, Binary } from 'mongodb';
import { createPostgresDatabase } from '../src/storage/postgres.js';
import { postgresConnection } from '../src/storage/configuration.js';
import { createApi } from '../src/app.js';

test(
  'PostgreSQL preserves document types, uniqueness, atomic claims, arrays, reports and scoped application registration',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const admin = new pg.Pool(postgresConnection(process.env.TEST_POSTGRES_URL));
    const name = 'az_test_' + randomUUID().replaceAll('-', '');
    await admin.query(`CREATE DATABASE ${name}`);
    const connection = { ...postgresConnection(process.env.TEST_POSTGRES_URL), database: name };
    const database = createPostgresDatabase(connection),
      other = createPostgresDatabase(connection);
    const directory = await mkdtemp(join(tmpdir(), 'agentzuno-installation-'));
    const oldDirectory = process.env.INSTALLATION_CONFIG_DIR;
    let app, server;
    try {
      const records = database.collection('records'),
        id = new ObjectId(),
        now = new Date();
      await records.createIndex({ ownerId: 1, name: 1 }, { unique: true });
      await records.insertOne({
        _id: id,
        ownerId: 'owner',
        name: 'one',
        at: now,
        version: 1,
        data: new Binary(Buffer.from('private file')),
        messages: [{ id: 'reply', status: 'queued' }],
      });
      const saved = await records.findOne({ _id: id });
      assert.ok(saved._id instanceof ObjectId);
      assert.ok(saved.at instanceof Date);
      assert.equal(saved.at.getTime(), now.getTime());
      assert.equal(saved.version, 1);
      assert.equal(Buffer.from(saved.data.buffer).toString(), 'private file');
      await assert.rejects(records.insertOne({ ownerId: 'owner', name: 'one' }), { code: 11000 });
      const claims = await Promise.all(
        [database, other].map((db) =>
          db.collection('records').findOneAndUpdate(
            { _id: id, version: 1 },
            {
              $set: {
                'messages.$[reply].status': 'complete',
                'messages.$[reply].text': 'Completed response',
              },
              $inc: { version: 1 },
            },
            { arrayFilters: [{ 'reply.id': 'reply' }], returnDocument: 'after' },
          ),
        ),
      );
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal(claims.find(Boolean).messages[0].status, 'complete');
      assert.equal(claims.find(Boolean).messages[0].text, 'Completed response');
      assert.equal((await records.find({ ownerId: 'other' }).toArray()).length, 0);
      assert.equal((await records.find({ name: /ONE/i }).toArray()).length, 1);
      assert.deepEqual(
        await records
          .aggregate([
            { $match: { ownerId: 'owner' } },
            { $facet: { counts: [{ $group: { _id: '$name', value: { $sum: 1 } } }] } },
          ])
          .toArray(),
        [{ counts: [{ _id: 'one', value: 1 }] }],
      );
      assert.ok(await records.findOneAndDelete({ _id: id }));
      assert.equal(await records.findOneAndDelete({ _id: id }), null);
      process.env.INSTALLATION_CONFIG_DIR = directory;
      app = createApi();
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      const call = async (path, body, cookie, method) => {
        const response = await fetch(origin + path, {
          method: method || (body ? 'POST' : 'GET'),
          headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return {
          status: response.status,
          body: await response.json(),
          cookie: response.headers.get('set-cookie')?.split(';')[0],
        };
      };
      assert.equal((await call('/api/installation/database')).body.configured, false);
      assert.deepEqual((await call('/api/auth/session')).body, { user: null });
      assert.equal((await call('/api/portal')).status, 200);
      assert.equal(
        (
          await call('/api/auth/register', {
            email: 'before@setup.test',
            password: 'Fictional-password!',
          })
        ).status,
        503,
      );
      const setup = {
        provider: 'postgres',
        mode: 'custom',
        connectionString: process.env.TEST_POSTGRES_URL.replace(/\/[^/]+$/, '/' + name),
        token: (await readFile(join(directory, 'setup.token'), 'utf8')).trim(),
      };
      assert.equal(
        (await call('/api/installation/database', { ...setup, token: 'a'.repeat(64) })).status,
        403,
      );
      const configured = await call('/api/installation/database', setup);
      assert.equal(configured.status, 200, JSON.stringify(configured.body));
      assert.equal((await call('/api/installation/database', setup)).status, 409);
      const encrypted = await readFile(join(directory, 'database.json'), 'utf8');
      assert.ok(!encrypted.includes(connection.password));
      const first = await call('/api/auth/register', {
        timezone: 'America/Los_Angeles',
        name: 'Alex Example',
        email: 'alex@postgres.test',
        password: 'Fictional-password-for-tests!',
      });
      assert.equal(first.status, 201, JSON.stringify(first.body));
      assert.equal(first.body.user.name, 'Alex Example');
      assert.equal(
        (await call('/api/auth/session', null, first.cookie)).body.user.id,
        first.body.user.id,
      );
      const second = await call('/api/auth/register', {
        name: 'Other',
        email: 'other@postgres.test',
        password: 'Fictional-password-for-tests!',
      });
      assert.equal(second.status, 201, JSON.stringify(second.body));
      assert.equal(
        (await call(`/api/workspaces/${first.body.user.workspaceId}`, null, second.cookie)).status,
        403,
      );
      const access = await call('/api/helpdesk/access', null, first.cookie);
      assert.equal(access.status, 200, JSON.stringify(access.body));
      assert.equal(access.body.role, 'admin');
      const profile = await call(
        `/api/helpdesk/workforce-profiles/${first.body.user.id}`,
        null,
        first.cookie,
      );
      assert.equal(profile.body.fields.timezone, 'America/Los_Angeles');
      const invalidTimezone = await call('/api/auth/register', {
        email: 'badzone@example.test',
        password: 'Fictional-password-for-tests!',
        timezone: ['UTC'],
      });
      assert.equal(invalidTimezone.status, 400);
      const png = await sharp({
        create: { width: 32, height: 32, channels: 3, background: '#818cf8' },
      })
        .png()
        .toBuffer();
      const upload = await fetch(origin + '/api/helpdesk/profile-picture', {
        method: 'PUT',
        headers: { cookie: first.cookie, 'Content-Type': 'image/png' },
        body: png,
      });
      assert.equal(upload.status, 200);
      const avatar = await call(
        `/api/helpdesk/profile-pictures/${first.body.user.id}`,
        null,
        first.cookie,
      );
      assert.equal(avatar.status, 200);
      const image = Buffer.from(avatar.body.image.split(',')[1], 'base64');
      assert.equal((await sharp(image).metadata()).format, 'webp');

      const removedPhoto = await call(
        '/api/helpdesk/profile-picture',
        { confirmed: true },
        first.cookie,
        'DELETE',
      );
      assert.equal(removedPhoto.status, 200, JSON.stringify(removedPhoto.body));
      const afterRemoval = await call(
        `/api/helpdesk/profile-pictures/${first.body.user.id}`,
        null,
        first.cookie,
      );
      assert.equal(afterRemoval.body.image, null);
      const removalAudit = await database.collection('governanceAudit').findOne({
        ownerId: first.body.user.id,
        target: '/helpdesk/profile-picture',
        method: 'DELETE',
        outcome: 'completed',
      });
      assert.ok(removalAudit);

      const demo = await call(
        '/api/helpdesk/demo/settings',
        { action: 'load', industry: 'tech', enableApprovals: true },
        first.cookie,
        'PUT',
      );
      assert.equal(demo.status, 200, JSON.stringify(demo.body));
      const inbox = await call('/api/helpdesk/inbox?list=1', null, first.cookie);
      assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
      assert.ok(inbox.body.total > 0);
      const catalog = await call('/api/helpdesk/catalog', null, first.cookie);
      assert.equal(catalog.status, 404);
      const removed = await call(
        '/api/helpdesk/demo/settings',
        { action: 'remove', industry: 'tech', confirmed: true },
        first.cookie,
        'PUT',
      );
      assert.equal(removed.status, 200, JSON.stringify(removed.body));
      const audit = await database
        .collection('governanceAudit')
        .countDocuments({ ownerId: first.body.user.id });
      assert.ok(audit > 0);
      const users = await database.collection('users').countDocuments({});
      assert.equal(users, 2);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await app?.locals.close();
      if (oldDirectory === undefined) delete process.env.INSTALLATION_CONFIG_DIR;
      else process.env.INSTALLATION_CONFIG_DIR = oldDirectory;
      await Promise.all([database.close(), other.close()]);
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
