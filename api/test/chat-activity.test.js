import test from 'node:test';
import assert from 'node:assert/strict';
import { chatActivity } from '../../src/services/chat/chatActivity.js';
test('chat activity tracks actual processing, completion and failures without inventing steps', () => {
  assert.deepEqual(
    chatActivity([], 'queued').map((step) => step.state),
    ['processing'],
  );
  const events = ['queued', 'preparing', 'reading-attachments', 'generating'].map((phase) => ({
    phase,
  }));
  assert.deepEqual(
    chatActivity(events, 'generating').map((step) => step.state),
    ['completed', 'completed', 'completed', 'processing'],
  );
  assert.ok(
    chatActivity([...events, { phase: 'complete' }], 'complete').every(
      (step) => step.state === 'completed',
    ),
  );
  const failed = chatActivity([...events, { phase: 'failed' }], 'failed');
  assert.equal(failed.at(-1).state, 'failed');
  assert.equal(failed.at(-1).phase, 'generating');
  assert.equal(chatActivity([], 'complete').length, 1);
  assert.equal(chatActivity([], 'failed')[0].state, 'failed');
});

test('generating and streaming response phases remain one activity step', () => {
  const events = ['queued', 'generating', 'responding'].map((phase) => ({ phase }));
  const active = chatActivity(events, 'responding');
  assert.equal(active.length, 2);
  assert.equal(active.at(-1).label, 'Generating response');
  assert.equal(active.at(-1).state, 'processing');
  assert.equal(chatActivity(events, 'complete').at(-1).state, 'completed');
  assert.equal(chatActivity(events, 'failed').at(-1).state, 'failed');
});
