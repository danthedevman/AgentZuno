import { publicAsset } from '../services/publicAsset.js';
import { createMemo } from 'solid-js';
import { useParams } from '@solidjs/router';
import { renderChatMarkdown, normalizeChatLinks } from '../services/chatMarkdown.js';
import { workspacePath } from '../services/workspaceRoutes.js';

export default function ChatMarkdown(props) {
  const params = useParams();
  const html = createMemo(() => {
    const rendered = normalizeChatLinks(
      renderChatMarkdown(props.text),
      {
        workspaceId: params.workspaceId,
        origin: window.location.origin,
      },
      document,
    );
    const isDemo = /^\/demo(?:\/|$)/.test(window.location.pathname);
    if (!props.externalLinksNewTab && !props.scrollTables && !isDemo) return rendered;
    const root = document.createElement('div');
    root.innerHTML = rendered;
    for (const link of root.querySelectorAll('a[href]')) {
      const url = new URL(link.getAttribute('href'), window.location.origin);
      if (
        url.origin === window.location.origin &&
        (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))
      )
        link.setAttribute('href', publicAsset(url.pathname + url.search + url.hash));
      if (isDemo && url.origin === window.location.origin)
        link.setAttribute('href', workspacePath(url.pathname + url.search + url.hash));
      if (
        props.externalLinksNewTab &&
        ['https:', 'http:'].includes(url.protocol) &&
        url.origin !== window.location.origin
      ) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    }
    if (props.scrollTables) {
      for (const table of root.querySelectorAll('table')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'docs-table-scroll';
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', 'Scrollable reference table');
        table.replaceWith(wrapper);
        wrapper.append(table);
      }
    }
    return root.innerHTML;
  });
  return <div class="chat-message-markdown" innerHTML={html()} />;
}
