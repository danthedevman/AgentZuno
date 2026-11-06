import { highlightCode } from '../codeHighlight.js';
import { Marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.code = ({ text, lang }) =>
  `<pre class="code-highlight"><code>${highlightCode(text, (lang || 'plaintext').split(/\s/)[0])}</code></pre>`;
renderer.image = ({ text }) => escapeHtml(text || 'Image');
const markdown = new Marked({ renderer, gfm: true, breaks: true });
const workspacePath = String.raw`/workspace/[a-f0-9]{24}(?:/[a-zA-Z0-9_-]+)*(?:\?[a-zA-Z0-9_%=&.-]+)?`;
const referencePattern = new RegExp(
  `^(?:["“]([^"”\\n]{1,200})["”]\\s*\\((${workspacePath})\\)|(${workspacePath}))`,
);
markdown.use({
  extensions: [
    {
      name: 'workspaceReference',
      level: 'inline',
      start(source) {
        const index = source.search(
          /(?:["“][^"”\n]{1,200}["”]\s*\(\/workspace\/|\/workspace\/[a-f0-9]{24})/,
        );
        return index < 0 ? undefined : index;
      },
      tokenizer(source) {
        if (this.lexer.state.inLink) return;
        const match = referencePattern.exec(source);
        if (match)
          return {
            type: 'workspaceReference',
            raw: match[0],
            title: match[1] || match[3],
            href: match[2] || match[3],
          };
      },
      renderer(token) {
        return `<a href="${escapeHtml(token.href)}">${escapeHtml(token.title)}</a>`;
      },
    },
  ],
});
const allowedTags = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'code',
  'span',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
];

export function renderChatMarkdown(text, purifier = DOMPurify) {
  if (typeof text !== 'string' || !text) return '';
  return purifier.sanitize(markdown.parse(text), {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['href', 'title', 'start', 'class'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

export function normalizeChatLinks(html, context, document) {
  if (!context?.workspaceId || !document) return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  for (const link of root.querySelectorAll('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href'), context.origin);
      const isApp =
        url.origin === context.origin || ['localhost', '127.0.0.1'].includes(url.hostname);
      if (!isApp || !/^\/workspace\/[a-f0-9]{24}(?:\/|$)/.test(url.pathname)) continue;
      if (/^my requests$/i.test(link.textContent.trim())) {
        link.setAttribute('href', `/workspace/${context.workspaceId}/requests`);
      } else if (url.pathname.startsWith(`/workspace/${context.workspaceId}/`)) {
        link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      /* Leave unrelated or malformed links to the sanitizer. */
    }
  }
  return root.innerHTML;
}
