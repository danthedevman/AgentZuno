import ToastMessage from '../../components/ToastMessage.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import A from '../../components/WorkspaceLink.jsx';
import { useParams, useNavigate, useSearchParams } from '@solidjs/router';
import { Match, Switch, Show, createSignal } from 'solid-js';
import ConnectionsPage from './ConnectionsPage.jsx';
import CreateArticlePage from './CreateArticlePage.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';

export default function CreatePage(props) {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const workspacePath = useWorkspacePath();
  const { session } = useSession();
  const { refresh } = useWorkspace();
  const recordType = () => props.record?.type || params.type;
  const option = () =>
    ({
      'knowledge-base': { name: 'Knowledge base' },
      article: { name: 'Article' },
      connection: { name: 'Connection' },
    })[recordType()];
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  async function save(event) {
    event.preventDefault();
    if (!session()?.user || isSaving()) return;
    setIsSaving(true);
    setError('');
    try {
      const form = new FormData(event.currentTarget);
      const record = {
        name: form.get('name'),
        description: form.get('description'),
      };
      const saved = await api(
        `/api/records/${recordType()}${props.record ? '/' + props.record.id : ''}`,
        {
          method: props.record ? 'PATCH' : 'POST',
          body: JSON.stringify(record),
        },
      );
      await refresh();
      const destination = {
        'knowledge-base': `/workspace/knowledge/bases/${saved.id}`,
        file: `/workspace/files/${saved.id}`,
      };
      navigate(workspacePath(destination[recordType()]));
    } catch (error) {
      setError(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Switch
      fallback={
        <section class="reading-page">
          <Show when={option()} fallback={<h1>Unknown content type</h1>}>
            <h1>
              {props.record ? 'Edit' : 'New'} {option()?.name.toLowerCase()}
            </h1>
            <Show when={!session()?.user}>
              <p>
                <A href="/login">Sign in</A> to save to your own workspace.
              </p>
            </Show>
            <ValidatedForm class="create-form" onSubmit={save}>
              <label>
                Name
                <input
                  name="name"
                  required
                  maxlength="160"
                  value={props.record?.name || searchParams.name || ''}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  rows="6"
                  maxlength="20000"
                  value={props.record?.description || ''}
                />
              </label>

              <Show when={error()}>
                <ToastMessage tone="error">{error()}</ToastMessage>
              </Show>
              <button
                class="workspace-button"
                type="submit"
                disabled={!session()?.user || isSaving()}
              >
                {isSaving() ? 'Saving…' : 'Save'}
              </button>
            </ValidatedForm>
          </Show>
        </section>
      }
    >
      <Match when={params.type === 'article'}>
        <CreateArticlePage />
      </Match>
      <Match when={params.type === 'connection'}>
        <ConnectionsPage />
      </Match>
    </Switch>
  );
}
