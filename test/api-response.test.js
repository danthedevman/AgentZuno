import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../src/services/apiResponse.js';

test('API errors never expose proxy HTML or JSON parser details', async () => {
  for (const status of [200, 502, 503, 504]) {
    const response = new Response('<html><h1>Gateway failure</h1></html>', {
      status,
      headers: { 'Content-Type': 'text/html' },
    });
    await assert.rejects(readApiResponse(response), (error) => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /<html>|Unexpected token|JSON/);
      assert.match(error.message, status === 504 ? /Check whether it completed/ : /try again/i);
      return true;
    });
  }
  assert.deepEqual(
    await readApiResponse(Response.json({ error: 'Choose a valid industry.' }, { status: 400 })),
    { error: 'Choose a valid industry.' },
  );
  assert.deepEqual(await readApiResponse(Response.json({ loaded: true })), { loaded: true });
  assert.equal(await readApiResponse(new Response(null, { status: 204 })), null);
});
