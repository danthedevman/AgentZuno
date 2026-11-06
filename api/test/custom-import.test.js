import test from 'node:test';
import assert from 'node:assert/strict';
import {
  endpointUrl,
  endpointHeaders,
  isPublicAddress,
  scanEndpoint,
} from '../src/integrations/customImport.js';

test('custom API endpoints reject unsafe URLs and private addresses', () => {
  for (const url of [
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'https://example.com/#fragment',
  ])
    assert.throws(() => endpointUrl(url));
  assert.throws(() => endpointUrl('https://other.example/next', 'https://example.com/articles'));
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '168.63.129.16',
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(
    endpointUrl('/next', 'https://example.com/articles').href,
    'https://example.com/next',
  );
});

test('custom API authentication validates headers and never permits header injection', () => {
  assert.deepEqual(endpointHeaders({ authentication: 'none' }), {});
  assert.equal(
    endpointHeaders({ authentication: 'bearer', secret: 'token' }).Authorization,
    'Bearer token',
  );
  assert.equal(
    endpointHeaders({ authentication: 'api-key', headerName: 'X-API-Key', secret: 'key' })[
      'X-API-Key'
    ],
    'key',
  );
  assert.equal(
    endpointHeaders({ authentication: 'basic', username: 'user', secret: 'pass' }).Authorization,
    'Basic dXNlcjpwYXNz',
  );
  for (const input of [
    { authentication: 'bearer', secret: 'secret\r\nHost: local' },
    { authentication: 'api-key', headerName: 'Host', secret: 'internal' },
    { authentication: 'api-key', headerName: 'Cookie', secret: 'cookie' },
    { authentication: 'basic', username: 'a:b', secret: 'pass' },
    { authentication: 'unknown', secret: 'pass' },
  ])
    assert.throws(() => endpointHeaders(input));
});

test('custom API scan collects bounded same-origin pages and fails without partial results', async () => {
  const calls = [];
  const result = await scanEndpoint(
    { endpoint: 'https://example.com/articles', authentication: 'bearer', secret: 'token' },
    async (url, headers) => {
      calls.push(url.href);
      assert.equal(headers.Authorization, 'Bearer token');
      return url.pathname === '/articles'
        ? { documents: [{ id: '1', title: 'First', text: 'Body' }], next: '/next' }
        : [{ id: '2', title: 'Second', text: 'Body' }];
    },
  );
  assert.equal(result.length, 2);
  assert.equal(calls.length, 2);
  await assert.rejects(
    scanEndpoint({ endpoint: 'https://example.com/articles' }, async () => ({
      documents: [],
      next: '/articles',
    })),
    /repeated/,
  );
  await assert.rejects(
    scanEndpoint({ endpoint: 'https://example.com/articles' }, async () => ({
      documents: [],
      next: 'https://other.example/next',
    })),
    /same origin/,
  );
  await assert.rejects(
    scanEndpoint({ endpoint: 'https://example.com/articles' }, async () => ({ results: [] })),
    /documents/,
  );
  await assert.rejects(
    scanEndpoint({ endpoint: 'https://example.com/articles' }, async () =>
      Array.from({ length: 1001 }, () => ({})),
    ),
    /1,000/,
  );
});

test('custom API transport blocks loopback before opening a connection', async () => {
  await assert.rejects(
    scanEndpoint({ endpoint: 'https://127.0.0.1/articles' }),
    /Private, local, and reserved/,
  );
});
