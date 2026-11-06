import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { renderChatMarkdown, normalizeChatLinks } from '../src/services/chat/chatMarkdown.js';

function render(text) {
  const window = new JSDOM('').window;
  const html = renderChatMarkdown(text, createDOMPurify(window));
  const root = window.document.createElement('div');
  root.innerHTML = html;
  return { root, window };
}

test('chat markdown renders formatting, tables, code and authorized workspace links', () => {
  const { root, window } = render(
    '# Heading\n\n**Bold** and *italic*\n\n- First\n- Second\n\n> Quote\n\n```js\nconst value = "<script>";\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Article](/workspace/fixture/articles/123)',
  );
  try {
    assert.equal(root.querySelector('h1').textContent, 'Heading');
    assert.equal(root.querySelector('strong').textContent, 'Bold');
    assert.equal(root.querySelectorAll('li').length, 2);
    assert.equal(root.querySelectorAll('td').length, 2);
    assert.ok(root.querySelector('blockquote'));
    assert.ok(root.querySelector('pre code').textContent.includes('<script>'));
    assert.equal(root.querySelector('a').getAttribute('href'), '/workspace/fixture/articles/123');
  } finally {
    window.close();
  }
});

test('chat markdown blocks executable HTML, unsafe protocols, injected attributes and remote images', () => {
  for (const payload of [
    '<script>alert(1)</script><img src=x onerror=alert(1)>',
    '<svg onload=alert(1)><a xlink:href="javascript:alert(1)">x</a></svg>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><form action="https://example.test">x</form>',
    '[unsafe](javascript:alert%281%29) [encoded](javascript&#58;alert%281%29) [data](data:text/html,payload)',
    '[test](https://example.test "title\\\" onmouseover=alert(1)")',
    '![tracking](https://example.test/track.png)',
    '<a href="javascript:alert(1)" style="background:red" onclick="alert(1)">unsafe</a>',
    '<script',
  ]) {
    const { root, window } = render(payload);
    try {
      assert.equal(
        root.querySelector('script, img, svg, iframe, form, input, style, object, embed'),
        null,
      );
      for (const element of root.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          assert.ok(!/^on|^style$|^srcdoc$/i.test(attribute.name));
          if (attribute.name === 'href')
            assert.ok(
              !/^(?:javascript|data|vbscript):/i.test(
                attribute.value.replace(/[\s\u0000-\u001f]/g, ''),
              ),
            );
        }
      }
    } finally {
      window.close();
    }
  }
});

test('chat references link quoted titles and bare workspace paths without changing code', () => {
  const path = '/workspace/6ae3f0a4ac61c90c4083135b/articles/6ae8a684cc9850d50e797a01';
  const { root, window } = render(
    `Related article "How to Access Slack" (${path}). Also ${path}.\n\n\`${path}\``,
  );
  try {
    assert.equal(root.querySelectorAll('a').length, 2);
    assert.equal(root.querySelector('a').textContent, 'How to Access Slack');
    assert.equal(root.querySelector('a').getAttribute('href'), path);
    assert.equal(root.querySelector('code').querySelector('a'), null);
  } finally {
    window.close();
  }
});

test('My Requests links use the current workspace request route and local origin', () => {
  const window = new JSDOM('').window;
  try {
    const workspaceId = '6ae644edd1dcb5f765377ae0';
    const html = normalizeChatLinks(
      '<a href="http://localhost:3000/workspace/6ae3f0a4ac61c90c4083135b">My Requests</a><a href="https://example.com">External</a>',
      { workspaceId, origin: 'https://help.example.test' },
      window.document,
    );
    const root = window.document.createElement('div');
    root.innerHTML = html;
    assert.equal(
      root.querySelector('a').getAttribute('href'),
      `/workspace/${workspaceId}/requests`,
    );
    assert.equal(root.querySelectorAll('a')[1].getAttribute('href'), 'https://example.com');
  } finally {
    window.close();
  }
});
