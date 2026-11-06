import { useToasts } from '../../../context/ToastContext.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import ImportSourceExport from '../../../components/connectors/ImportSourceExport.jsx';
import ImportApiEndpoint from '../../../components/connectors/ImportApiEndpoint.jsx';
import { useParams } from '@solidjs/router';
import { Show, createResource, createSignal } from 'solid-js';
import { api } from '../../../services/api.js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import ConnectSource from '../../../components/connectors/ConnectSource.jsx';
import ValidatedForm from '../../../components/ValidatedForm.jsx';
import PageHeading from '../../../components/PageHeading.jsx';

export default function EditConnectionPage() {
  const params = useParams();
  const { refresh } = useWorkspace();
  const [data] = createResource(
    () => params.id,
    async (id) => {
      const connection = await api(`/api/connections/${id}`);
      const catalog = await api(
        `/api/integration-catalog?provider=${encodeURIComponent(connection.provider)}`,
      );
      return { connection, app: catalog[0] };
    },
  );
  const { notify } = useToasts();
  const [saving, setSaving] = createSignal(false);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const name = new FormData(event.currentTarget).get('name');
    try {
      await api(`/api/connections/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      await refresh();
      notify({ tone: 'success', message: 'Connection saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page">
      <PageHeading title="Edit connection" />
      <Show
        when={!data.error}
        fallback={<ToastMessage tone="error">Connection unavailable.</ToastMessage>}
      >
        <Show when={data()} keyed fallback={<Skeleton label="Loading connection" lines={6} />}>
          {({ connection, app }) =>
            connection.authType === 'export' ? (
              <>
                <ValidatedForm class="create-form" onSubmit={save}>
                  <label>
                    Name
                    <input name="name" value={connection.name} maxlength="160" required />
                  </label>
                  <button class="workspace-button" disabled={saving()}>
                    Save
                  </button>
                  <p>
                    Import another export to replace snapshot content. Source permissions are not
                    synchronized.
                  </p>
                </ValidatedForm>
                <ImportSourceExport app={app} connection={connection} onImported={refresh} />
                <Show when={app.id === 'custom'}>
                  <ImportApiEndpoint connection={connection} onImported={refresh} />
                </Show>
              </>
            ) : (
              <ConnectSource app={app} connection={connection} />
            )
          }
        </Show>
      </Show>
    </section>
  );
}
