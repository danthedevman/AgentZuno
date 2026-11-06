import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowChatText } from '../src/services/workflows/workflowChatText.js';
import { highlightCode } from '../src/services/codeHighlight.js';
import { chatActivity } from '../src/services/chat/chatActivity.js';
test('workflow definition stays hidden during partial and completed streaming', () => {
  assert.equal(workflowChatText('Updating.\n```json\n{"version":'), 'Updating.');
  assert.equal(workflowChatText('Updated.\n```json\n{"version":1}\n```'), 'Updated.');
  assert.equal(workflowChatText('{"version":'), '');
});
test('code highlighting escapes executable markup', () => {
  const html = highlightCode('const text = "<script>alert(1)</script>"', 'typescript');
  assert.ok(html.includes('hljs-keyword'));
  assert.ok(!html.includes('<script>'));
});
test('response phases share one activity step', () => {
  const steps = chatActivity([{ phase: 'generating' }, { phase: 'responding' }], 'responding');
  assert.equal(steps.length, 1);
});
