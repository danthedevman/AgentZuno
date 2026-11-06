import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSlackReply, slackPortalFooter } from '../src/channels/slackFormatting.js';

test('Slack portal footer uses small context text and the web portal rather than a channel-only chat', () => {
  const footer = slackPortalFooter('workspace-id');
  assert.equal(footer.type, 'context');
  assert.equal(footer.elements[0].type, 'mrkdwn');
  assert.ok(footer.elements[0].text.includes('/workspace/workspace-id/chat|'));
  assert.ok(footer.elements[0].text.endsWith('View in AgentZuno’s Portal>'));
});

test('Slack responses render links, headings, lists and bold without activating injected mentions', () => {
  assert.equal(
    formatSlackReply(
      '# Request access\n**Salesforce**\n- [Open request](https://example.test/request?id=1&tab=form)\n<@U123> <!channel>',
    ),
    '*Request access*\n*Salesforce*\n• <https://example.test/request?id=1&amp;tab=form|Open request>\n&lt;@U123&gt; &lt;!channel&gt;',
  );
  assert.equal(
    formatSlackReply(
      '[Unsafe](javascript:alert) [Secret](https://user:pass@example.test) [Bad](https://example.test/|x)',
    ),
    'Unsafe Secret Bad',
  );
  assert.equal(
    formatSlackReply('`**literal** <tag>`\n```js\nconst x = "<value>";\n```'),
    '`**literal** &lt;tag&gt;`\n```\nconst x = "&lt;value&gt;";\n```',
  );
  assert.ok(formatSlackReply('<'.repeat(20000)).length <= 35000);
  assert.equal(
    formatSlackReply('Visit https://example.test/request?id=1&tab=form.'),
    'Visit <https://example.test/request?id=1&amp;tab=form|https://example.test/request?id=1&amp;tab=form>.',
  );
});
