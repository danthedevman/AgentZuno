import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceClient } from '../src/connectors/index.js';
import { validateAdapterConfig, publicAdapter } from '../src/connectors/registry.js';
import { createSourceHttp } from '../src/connectors/http.js';

const id = '11111111-1111-4111-8111-111111111111';
const fixtures = [
  {
    provider: 'document360',
    config: { authType: 'api-key', region: 'eu', projectId: id, sourceWorkspaceId: id },
    header: 'X-API-Key',
    expected: 'fixture-key',
    responses: {
      [`/v3/projects/${id}`]: { data: { id, name: 'Product docs' } },
      [`/v3/projects/${id}/workspaces/${id}`]: { data: { id, name: 'Main' } },
      [`/v3/projects/${id}/workspaces/${id}/articles`]: {
        data: [{ id, status: 'published', public_version: 1 }],
        pagination: { has_more: false },
      },
      [`/v3/projects/${id}/articles/${id}`]: {
        data: {
          id,
          title: 'Guide',
          html_content: '<p>Content</p>',
          status: 'published',
          workspace_id: id,
        },
      },
    },
  },
  {
    provider: 'freshdesk',
    config: { authType: 'api-key', tenant: 'example' },
    header: 'Authorization',
    expected: `Basic ${Buffer.from('fixture-key:X').toString('base64')}`,
    responses: {
      '/api/v2/agents/me': { id: 1, contact: { name: 'Reader' } },
      '/api/v2/solutions/categories': [{ id: 1, name: 'Policies' }],
      '/api/v2/solutions/categories/1/folders': [{ id: 2 }],
      '/api/v2/solutions/folders/2/articles': [{ id: 3, status: 2 }],
      '/api/v2/solutions/articles/3': {
        id: 3,
        title: 'Guide',
        description: '<p>Content</p>',
        status: 2,
      },
    },
  },
  {
    provider: 'help-scout',
    config: { authType: 'api-key' },
    header: 'Authorization',
    expected: `Basic ${Buffer.from('fixture-key:X').toString('base64')}`,
    responses: {
      '/v1/collections': {
        collections: { items: [{ id: 'collection', name: 'Policies' }], pages: 1 },
      },
      '/v1/collections/collection/articles': {
        articles: { items: [{ id: 'article', status: 'published' }], pages: 1 },
      },
      '/v1/articles/article': {
        article: {
          id: 'article',
          name: 'Guide',
          text: '<p>Content</p>',
          status: 'published',
          collectionId: 'collection',
        },
      },
    },
  },
  {
    provider: 'intercom',
    config: { authType: 'oauth', region: 'us' },
    header: 'Authorization',
    expected: 'Bearer fixture-key',
    responses: {
      '/me': { id: 'owner', name: 'Reader', app: { id_code: 'app', name: 'Help center' } },
      '/articles': { data: [{ id: 1, state: 'published' }], pages: { next: null } },
      '/articles/1': {
        id: 1,
        title: 'Guide',
        body: '<p>Content</p>',
        state: 'published',
        updated_at: 1735689600,
      },
    },
  },
  {
    provider: 'helpjuice',
    config: { authType: 'api-key', tenant: 'example' },
    header: 'Authorization',
    expected: 'fixture-key',
    responses: {
      '/api/v3/settings': { settings: {} },
      '/api/v3/articles': { articles: [{ id: 1, published: true }], meta: { total_pages: 1 } },
      '/api/v3/articles/1': {
        article: { id: 1, name: 'Guide', answer: [{ body: '<p>Content</p>' }], published: true },
      },
    },
  },
];
for (const fixture of fixtures)
  test(`${fixture.provider} verifies credentials, imports knowledge and stays managed-only`, async () => {
    const adapter = publicAdapter(fixture.provider);
    assert.equal(adapter.adapterImplemented, true);
    assert.equal(adapter.sourcePermissionsSupported, false);
    const config = validateAdapterConfig(fixture.provider, fixture.config, fixture.config.authType);
    const source = sourceClient(fixture.provider, config, 'fixture-key', async (url, options) => {
      assert.equal(url.protocol, 'https:');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers[fixture.header], fixture.expected);
      const data = fixture.responses[url.pathname];
      assert.ok(data, `Unexpected fixture path ${url.pathname}`);
      return Response.json(data);
    });
    assert.ok((await source.principal()).id);
    assert.equal(source.supportsUserPermissions, false);
    const articles = [];
    for await (const article of source.documents()) articles.push(article);
    assert.equal(articles.length, 1);
    assert.equal(articles[0].text, 'Content');
    assert.equal(articles[0].title, 'Guide');
    assert.ok(articles[0].knowledgeBase.name);
  });
test('connector transport blocks host changes, malformed settings, credentials in URLs and rate-limit leaks', async () => {
  assert.throws(() =>
    validateAdapterConfig('freshdesk', { tenant: 'example.test@localhost' }, 'api-key'),
  );
  assert.throws(() => validateAdapterConfig('document360', { region: 'attacker' }, 'api-key'));
  const request = createSourceHttp(
    'https://api.example.test',
    { Authorization: 'secret' },
    async () => new Response('', { status: 429, headers: { 'Retry-After': '45' } }),
  );
  await assert.rejects(request('https://attacker.test/collect'), /unexpected pagination URL/);
  await assert.rejects(
    request('https://user:secret@api.example.test/'),
    /unexpected pagination URL/,
  );
  await assert.rejects(request('/allowed'), { status: 429, retryAfter: 45000 });
});
