import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('plaintext', plaintext);
export function highlightCode(code, language = 'typescript') {
  const selected = { ts: 'typescript', js: 'javascript' }[language] || language;
  return hljs.highlight(String(code || ''), {
    language: hljs.getLanguage(selected) ? selected : 'plaintext',
    ignoreIllegals: true,
  }).value;
}
