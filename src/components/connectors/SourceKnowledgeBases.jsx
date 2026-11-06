import ToastMessage from '../ToastMessage.jsx';
import { For, Show, createSignal, createResource } from 'solid-js';
import { api } from '../../services/api.js';
export default function SourceKnowledgeBases(props) {
  const [show, setShow] = createSignal(false);
  const [bases] = createResource(
    () => (show() ? props.connection.id : false),
    (id) => api(`/api/connections/${id}/bases`),
  );
  const [index, { refetch }] = createResource(
    () => props.connection.id,
    (id) => api(`/api/connections/${id}/index`),
  );
  return (
    <section class="connection-knowledge">
      <h3>Knowledge index</h3>
      <Show when={!index.error && index()}>
        {(data) => (
          <p>
            {data().semanticConfigured
              ? data()
                  .counts.map((item) => `${item.count} ${item._id.toLowerCase()}`)
                  .join(' · ') || 'Import knowledge to start indexing.'
              : 'Semantic services are not configured. Keyword search remains available.'}
          </p>
        )}
      </Show>
      <Show when={index.error}>
        <ToastMessage tone="error">Index status unavailable.</ToastMessage>
      </Show>
      <button class="card-link" type="button" onClick={() => refetch()}>
        Refresh index status
      </button>
      <Show when={props.connection.provider === 'servicenow'}>
        <button class="card-link" type="button" onClick={() => setShow(!show())}>
          {show() ? 'Hide source knowledge bases' : 'Browse source knowledge bases'}
        </button>
      </Show>
      <Show when={show()}>
        <Show when={bases.loading}>
          <p role="status">Checking ServiceNow access…</p>
        </Show>
        <Show when={bases.error}>
          <ToastMessage tone="error">
            Could not verify source bases. Check the knowledge-bases bridge resource and delegated
            identity.
          </ToastMessage>
        </Show>
        <Show when={!bases.error && bases()}>
          <ul>
            <For each={bases()}>{(base) => <li>{base.name}</li>}</For>
          </ul>
          <Show when={!bases()?.length}>
            <p>No bases with readable published articles.</p>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
