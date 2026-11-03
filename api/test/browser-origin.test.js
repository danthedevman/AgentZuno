import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedBrowserOrigin } from '../src/browserOrigin.js';
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
