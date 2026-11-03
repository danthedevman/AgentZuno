import Skeleton from '../../components/Skeleton.jsx';
import ArticleLayout from '../../components/ArticleLayout.jsx';
import { useParams } from '@solidjs/router';
import { Show, createResource, createEffect } from 'solid-js';
import { api } from '../../services/api.js';

export default function SourceDocumentPage() {
  const params = useParams();
  const [document] = createResource(
    () => params.id,
    (id) => api(`/api/knowledge/documents/${id}`),
  );
  const recorded = new Set();
  createEffect(() => {
    if (document.error || !document() || recorded.has(params.id)) return;
    recorded.add(params.id);
    api('/api/knowledge/views', {
      method: 'POST',
      body: JSON.stringify({ kind: 'source', documentId: params.id, eventId: crypto.randomUUID() }),
    }).catch(() => {});
  });
  return (
    <section class="reading-page">
      <Show when={document.loading}>
        <Skeleton label="Verifying document access" lines={8} />
      </Show>
      <Show when={document.error}>
        <h1>Document unavailable</h1>
        <p>Access could not be verified.</p>
      </Show>
      <Show when={!document.error && document()}>
        {(item) => (
          <ArticleLayout article={item()} isImported>
            <h1>{item().title}</h1>
            <p class="card-meta">
              {item().permissionMode === 'source'
                ? 'Source access verified for this request'
                : 'AgentZuno-managed private copy'}
            </p>
            <div class="source-document-text">{item().text}</div>
            <Show when={item().sourceUrl}>
              <p>
                <a href={item().sourceUrl} target="_blank" rel="noreferrer">
                  Open original source
                </a>
              </p>
            </Show>
          </ArticleLayout>
        )}
      </Show>
    </section>
  );
}
