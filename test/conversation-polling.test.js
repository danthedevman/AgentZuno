import test from 'node:test';
import assert from 'node:assert/strict';
import { startConversationPolling } from '../src/services/conversationPolling.js';

test('conversation polling waits for an in-flight refresh and does not restart after cancellation', async () => {
  let calls = 0,
    release;
  const stop = startConversationPolling(
    () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    { delay: 5 },
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls, 1);
  stop();
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
});
