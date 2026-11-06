import { createResource, For, Show } from 'solid-js';
import { api } from '../../services/api.js';
import A from '../WorkspaceLink.jsx';
export default function RequestAccess(props) {
  const [records] = createResource(
    () => props.requestId,
    (id) => api(`/api/helpdesk/user-access?request=${encodeURIComponent(id)}`),
  );
  return (
    <Show when={!records.error && records()?.rows?.length}>
      <section>
        <h3>Application Access</h3>
        <For each={records().rows}>
          {(item) => (
            <p>
              <A href={`/workspace/access/${item.id}`}>
                {item.applicationName} · {item.accessLevel}
              </A>{' '}
              · {item.status}
            </p>
          )}
        </For>
      </section>
    </Show>
  );
}
