import { queryString, queryStrings, queryVersion } from '../src/shared/queryValues.js';
import { helpdeskScope, requestScope, resolveHelpdeskUser } from '../src/identity/helpdeskRoles.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { uploadBytes } from '../src/shared/uploadBytes.js';
import { isEmailAddress } from '../src/shared/emailAddress.js';
import { installSmtpRoutes } from '../src/routes/channels/smtpSettingsRoutes.js';
import { installChatAttachmentRoutes } from '../src/routes/chat/chatAttachmentsRoutes.js';
import { listResponse } from '../src/shared/listQuery.js';

test('uploads reject parameter-tampering objects and arrays before inspecting their contents', () => {
  for (const body of [
    undefined,
    null,
    '',
    'file',
    [],
    [1, 2],
    { length: 1 },
    { type: 'Buffer', data: [1] },
  ])
    assert.throws(() => uploadBytes(body, 10), { status: 400 });
  assert.throws(() => uploadBytes(Buffer.alloc(0), 10), { status: 400 });
  assert.throws(() => uploadBytes(Buffer.alloc(11), 10), { status: 400 });
  const bytes = Buffer.from('hello');
  const result = uploadBytes(bytes, 10);
  assert.deepEqual(result, bytes);
  assert.notEqual(result, bytes);
});

test('email validation is bounded and rejects duplicate separators, whitespace, and malformed domains', () => {
  for (const email of ['user@example.test', 'first.last+support@sub.example.com'])
    assert.equal(isEmailAddress(email), true);
  for (const email of [
    null,
    [],
    {},
    'user',
    '@example.test',
    'user@@example.test',
    'user@.test',
    'user@example.',
    'user@exam ple.test',
    '!@!.' + '!.'.repeat(50000),
  ])
    assert.equal(isEmailAddress(email), false);
});

test('list sorting rejects inherited, array, and object method names', () => {
  for (const sort of ['constructor', '__proto__', 'toString', ['Name'], { Name: true }])
    assert.throws(
      () => listResponse({ query: { list: '1', sort } }, [{ name: 'A' }], { Name: 'name' }),
      { status: 400 },
    );
});

test('SMTP attempts are throttled before further authorization or database work and upload JSON fails closed', async () => {
  const app = express();
  let reads = 0;
  const store = {
    collection: () => ({
      findOne: async () => {
        reads++;
        return null;
      },
    }),
  };
  app.use(express.json());
  app.use((request, response, next) => {
    request.helpdeskUser = { id: 'owner', workspaceId: 'workspace', role: 'admin' };
    next();
  });
  installSmtpRoutes(app, store);
  installChatAttachmentRoutes(app, store);
  app.use((error, request, response, next) =>
    response.status(error.status || 500).json({ error: error.publicMessage || 'Invalid request.' }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 10; i++)
      assert.equal((await fetch(root + '/api/helpdesk/smtp/test', { method: 'POST' })).status, 409);
    const blocked = await fetch(root + '/api/helpdesk/smtp/test', { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal(reads, 10);
    for (const version of [{ $ne: 0 }, [0], '0', -1, Number.MAX_SAFE_INTEGER + 1]) {
      const response = await fetch(root + '/api/helpdesk/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: 'smtp.example.test',
          port: 587,
          from: 'support@example.test',
          username: '',
          password: '',
          version,
        }),
      });
      assert.equal(response.status, 400);
    }
    assert.equal(reads, 10);
    for (const body of [{ length: 1 }, ['content']]) {
      const result = await fetch(root + '/api/helpdesk/chat-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-File-Name': 'file.txt' },
        body: JSON.stringify(body),
      });
      assert.equal(result.status, 400);
    }
    assert.equal(reads, 10);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('query scalars reject operators, malformed identities and unsafe versions before database access', async () => {
  for (const value of [{ $ne: null }, { $gt: 0 }, [], ['owner'], null, undefined, 42]) {
    assert.throws(() => queryString(value), { status: 400 });
    assert.throws(() => helpdeskScope({ id: value, workspaceId: 'workspace' }), { status: 400 });
  }
  for (const value of [{ $ne: 0 }, [1], '1', -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => queryVersion(value), { status: 400 });
  for (const value of [{ $in: ['Support'] }, [{ $ne: '' }], ['x'.repeat(81)]])
    assert.throws(() => queryStrings(value, 30, 80), { status: 400 });
  assert.equal(queryString('owner'), 'owner');
  assert.equal(queryVersion(2), 2);
  assert.deepEqual(queryStrings(['Support']), ['Support']);
  assert.throws(
    () =>
      requestScope({ role: 'agent', id: 'owner', workspaceId: 'workspace', queues: [{ $ne: '' }] }),
    { status: 400 },
  );
  let reads = 0;
  const store = {
    ready: async () => {},
    collection: () => ({
      findOne: async () => {
        reads++;
      },
    }),
  };
  await assert.rejects(resolveHelpdeskUser(store, { id: 'owner' }, { $ne: null }), { status: 400 });
  assert.equal(reads, 0);
});
