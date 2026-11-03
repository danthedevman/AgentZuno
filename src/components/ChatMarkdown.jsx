import { createMemo } from 'solid-js';
import { useParams } from '@solidjs/router';
import { renderChatMarkdown, normalizeChatLinks } from '../services/chatMarkdown.js';

export default function ChatMarkdown(props) {
  const params = useParams();
  const html = createMemo(() =>
    normalizeChatLinks(
      renderChatMarkdown(props.text),
      {
        workspaceId: params.workspaceId,
        origin: window.location.origin,
      },
      document,
    ),
  );
  return <div class="chat-message-markdown" innerHTML={html()} />;
}
