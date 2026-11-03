import { useParams } from '@solidjs/router';
import { For, Show, createResource } from 'solid-js';
import { api } from '../services/api.js';
export default function ArticleAttachments(props) {
  const params = useParams();
  const [files] = createResource(
    () => props.articleId || false,
    (id) => api(`/api/helpdesk/article-attachment-list/${id}`),
  );
  return (
    <Show when={!files.error && files()?.length}>
      <section class="article-attachments">
        <h2>Attachments</h2>
        <For each={files()}>
          {(file) => (
            <p>
              <a
                href={`/api/helpdesk/article-attachments/${file.id}?article=${encodeURIComponent(props.articleId)}&workspace=${encodeURIComponent(params.workspaceId || '')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {file.name}
              </a>
            </p>
          )}
        </For>
      </section>
    </Show>
  );
}
