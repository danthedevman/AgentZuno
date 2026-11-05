import test from 'node:test';
import assert from 'node:assert/strict';
import { readAIStream } from '../src/aiStream.js';
import { toolTurns } from '../src/aiTools.js';
function stream(items) {
  return new Response(items.map((item) => 'data: ' + JSON.stringify(item) + '\n\n').join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
test('Claude tool continuations preserve signed thinking privately and unchanged', async () => {
  const updates = [];
  const result = await readAIStream(
    stream([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Private ' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'reasoning' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'signed-' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'value' },
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'redacted_thinking', data: 'opaque' },
      },
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'call-1', name: 'listGroups', input: {} },
      },
      { type: 'message_stop' },
    ]),
    'anthropic',
    (update) => updates.push(update),
    true,
  );
  const turns = toolTurns('anthropic', result.toolOutput, [
    { call: result.toolCalls[0], result: { groups: [] } },
  ]);
  assert.deepEqual(turns[0].content[0], {
    type: 'thinking',
    thinking: 'Private reasoning',
    signature: 'signed-value',
  });
  assert.deepEqual(turns[0].content[1], { type: 'redacted_thinking', data: 'opaque' });
  assert.equal(result.text, '');
  assert.deepEqual(updates, []);
});
test('tool-only streams retain native tool calls without displaying arguments as chat text', async () => {
  const frames = {
    openai: [
      {
        type: 'response.completed',
        response: {
          output: [
            { type: 'function_call', call_id: 'a', name: 'getCurrentUser', arguments: '{}' },
          ],
        },
      },
    ],
    anthropic: [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'a', name: 'getCurrentUser', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'message_stop' },
    ],
    google: [
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'getCurrentUser', args: {}, id: 'a' },
                  thoughtSignature: 'signed-call',
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      },
    ],
  };
  for (const [provider, items] of Object.entries(frames)) {
    const updates = [];
    const result = await readAIStream(
      stream(items),
      provider,
      (update) => updates.push(update),
      true,
    );
    assert.equal(result.toolCalls[0].name, 'getCurrentUser');
    assert.deepEqual(result.toolCalls[0].arguments, {});
    assert.equal(updates.length, 0);
    assert.equal(result.text, '');
    if (provider === 'google')
      assert.equal(
        result.toolOutput.candidates[0].content.parts[0].thoughtSignature,
        'signed-call',
      );
  }
});
