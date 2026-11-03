import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sourceClient } from '../src/connectors/index.js';

test('ServiceNow adapter requires its permission bridge and denies changed identity or denied articles', async () => {
  const id = 'a'.repeat(32);
  let identity = 'reader';
  let canRead = true;
  const config = {
    tenant: 'example',
    namespace: 'x_company_agentzuno',
    expectedPrincipalId: 'reader',
  };
  const source = sourceClient('servicenow', config, 'fixture-token', async (url, options) => {
    assert.equal(url.origin, 'https://example.service-now.com');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    assert.ok(!url.pathname.includes('/table/'));
    if (url.pathname.endsWith('/me'))
      return Response.json({
        result: { id: identity, name: 'Reader', permissionCheck: 'KBKnowledge.canRead' },
      });
    if (!canRead) return new Response('', { status: 404 });
    return Response.json({
      result: {
        id,
        title: 'Restricted policy',
        text: '<p>Allowed content</p>',
        knowledgeBase: { id: 'kb', name: 'Policies' },
      },
    });
  });
  assert.equal(source.supportsUserPermissions, true);
  assert.equal((await source.read(id)).text, 'Allowed content');
  identity = 'other';
  await assert.rejects(source.read(id), { status: 403 });
  identity = 'reader';
  canRead = false;
  await assert.rejects(source.read(id));
  const missingBridge = sourceClient('servicenow', config, 'fixture-token', async () =>
    Response.json({ result: { id: 'reader' } }),
  );
  await assert.rejects(missingBridge.principal(), { status: 422 });
  assert.throws(() =>
    sourceClient('servicenow', { ...config, namespace: '../now/table' }, 'fixture-token'),
  );
});

test('ServiceNow bridge requires authenticated users, record ACLs, field ACLs and knowledge criteria', async () => {
  let allowed = true;
  let fieldAllowed = true;
  let recordAllowed = true;
  let guest = false;
  let state = 'published';
  let baseAllowed = true;
  const context = vm.createContext({
    Class: { create: () => function () {} },
    gs: {
      getUserID: () => (guest ? '' : 'reader'),
      getUserName: () => (guest ? 'guest' : 'reader'),
    },
    GlideRecordSecure: function () {
      this.get = () => true;
      this.canRead = () => baseAllowed;
      this.getElement = () => ({ canRead: () => fieldAllowed });
      this.getValue = () => 'Knowledge base';
    },
    KBKnowledge: function () {
      this.canRead = () => allowed;
    },
  });
  vm.runInContext(
    await readFile(
      new URL('../../integrations/servicenow/AgentZunoKnowledge.js', import.meta.url),
      'utf8',
    ),
    context,
  );
  const access = new context.AgentZunoKnowledge();
  const record = {
    isValidRecord: () => true,
    canRead: () => recordAllowed,
    getElement: () => ({ canRead: () => fieldAllowed }),
    getUniqueValue: () => 'id',
    getValue: (name) => (name === 'workflow_state' ? state : name),
    getDisplayValue: () => 'Knowledge base',
  };
  assert.equal(access.article(record).title, 'short_description');
  baseAllowed = false;
  assert.equal(access.article(record), null);
  baseAllowed = true;
  allowed = false;
  assert.equal(access.article(record), null);
  allowed = true;
  fieldAllowed = false;
  assert.equal(access.article(record), null);
  fieldAllowed = true;
  recordAllowed = false;
  assert.equal(access.article(record), null);
  recordAllowed = true;
  state = 'retired';
  assert.equal(access.article(record), null);
  guest = true;
  assert.throws(() => access.article(record), /Authentication required/);
});

test('ServiceNow imports permission-filtered batches and discovers readable bases without per-article rereads', async () => {
  const id = 'b'.repeat(32);
  const baseId = 'c'.repeat(32);
  const calls = [];
  const source = sourceClient(
    'servicenow',
    { tenant: 'example', namespace: 'x_agentzuno', expectedPrincipalId: 'reader' },
    'fixture',
    async (url) => {
      calls.push(url.pathname);
      if (url.pathname.endsWith('/me'))
        return Response.json({ result: { id: 'reader', permissionCheck: 'KBKnowledge.canRead' } });
      if (url.pathname.endsWith('/knowledge-bases'))
        return Response.json({
          result: { items: [{ id: baseId, name: 'Policies' }], nextCursor: null },
        });
      if (url.pathname.endsWith('/articles'))
        return Response.json({
          result: {
            items: [
              {
                id,
                title: 'VPN',
                text: '<p>Allowed</p>',
                knowledgeBase: { id: baseId, name: 'Policies' },
              },
            ],
            nextCursor: null,
          },
        });
      throw new Error('Unexpected individual article request');
    },
  );
  const documents = [];
  for await (const item of source.documents()) documents.push(item);
  assert.equal(documents[0].text, 'Allowed');
  assert.equal(calls.length, 2);
  assert.deepEqual(await source.knowledgeBases(), [{ id: baseId, name: 'Policies' }]);
});
