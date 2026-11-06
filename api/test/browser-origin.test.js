import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedBrowserOrigin } from '../src/shared/browserOrigin.js';
test('browser writes accept equivalent loopback origins only on the configured protocol and port', () => {
  assert.equal(isAllowedBrowserOrigin('http://127.0.0.1:3000', 'http://localhost:3000'), true);
  assert.equal(isAllowedBrowserOrigin('http://localhost:3012', 'http://127.0.0.1:3012'), true);
  for (const value of [
    'http://localhost:3001',
    'https://localhost:3000',
    'http://localhost.attacker.test:3000',
    'null',
    'http://127.0.0.2:3000',
    'http://localhost:3000/path',
    'http://attacker@localhost:3000',
  ])
    assert.equal(isAllowedBrowserOrigin(value, 'http://localhost:3000'), false, value);
  assert.equal(isAllowedBrowserOrigin('https://zuno.example', 'https://zuno.example'), true);
  assert.equal(isAllowedBrowserOrigin('http://localhost:3000', 'https://zuno.example'), false);
});

test('additional browser origins are explicit and preserve protocol, port and origin validation', () => {
  const canonical = 'https://tunnel.example';
  const additional = 'http://localhost:3000';
  assert.equal(isAllowedBrowserOrigin('http://localhost:3000', canonical, additional), true);
  assert.equal(isAllowedBrowserOrigin('http://127.0.0.1:3000', canonical, additional), true);
  assert.equal(isAllowedBrowserOrigin(canonical, canonical, additional), true);
  for (const origin of [
    'http://localhost:3001',
    'https://localhost:3000',
    'https://attacker.test',
    'null',
    'http://localhost:3000/path',
    'http://attacker@localhost:3000',
  ])
    assert.equal(isAllowedBrowserOrigin(origin, canonical, additional), false, origin);
  assert.equal(isAllowedBrowserOrigin('https://attacker.test', canonical, '*'), false);
  assert.equal(
    isAllowedBrowserOrigin('https://attacker.test', canonical, { origin: 'https://attacker.test' }),
    false,
  );
});
