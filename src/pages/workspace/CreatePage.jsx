import ToastMessage from '../../components/ToastMessage.jsx';
import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import KnowledgePermissions from '../../components/knowledge/KnowledgePermissions.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import A from '../../components/WorkspaceLink.jsx';
import { useParams, useNavigate, useSearchParams } from '@solidjs/router';
import { Match, Switch, Show, createSignal } from 'solid-js';
import ConnectionsPage from './connectors/ConnectionsPage.jsx';
import CreateArticlePage from './knowledge/CreateArticlePage.jsx';
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
  const [permissions, setPermissions] = createSignal();
  const [savedRecordId, setSavedRecordId] = createSignal(props.record?.id);

  async function save(event) {
    event.preventDefault();
    if (!session()?.user || isSaving()) return;
    if (recordType() === 'knowledge-base' && !permissions()?.ready) return;
    const form = new FormData(event.currentTarget);
    setIsSaving(true);
    setError('');
    try {
      const record = {
        name: form.get('name'),
        description: form.get('description'),
      };
      const saved = await api(
        `/api/records/${recordType()}${savedRecordId() ? '/' + savedRecordId() : ''}`,
        {
          method: savedRecordId() ? 'PATCH' : 'POST',
          deferSavedEvent: recordType() === 'knowledge-base',
          body: JSON.stringify(record),
        },
      );
      setSavedRecordId(saved.id);
      if (recordType() === 'knowledge-base') {
        await permissions().save(saved.id);
        window.dispatchEvent(new Event('agentzuno-form-saved'));
      }
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
            <Breadcrumbs
              items={[
                {
                  label: recordType() === 'knowledge-base' ? 'Knowledge Bases' : 'Connectors',
                  href:
                    recordType() === 'knowledge-base'
                      ? '/workspace/knowledge'
                      : '/workspace/connectors',
                },
                props.record &&
                  recordType() === 'knowledge-base' && {
                    label: props.record.name,
                    href: `/workspace/knowledge/bases/${props.record.id}`,
                  },
                { label: `${props.record ? 'Edit' : 'New'} ${option()?.name}` },
              ]}
            />
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
                  disabled={isSaving()}
                  required
                  maxlength="160"
                  value={props.record?.name || searchParams.name || ''}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  disabled={isSaving()}
                  rows="6"
                  maxlength="20000"
                  value={props.record?.description || ''}
                />
              </label>

              <Show when={recordType() === 'knowledge-base'}>
                <section class="knowledge-base-edit-permissions">
                  <h2>Permissions</h2>
                  <KnowledgePermissions
                    kind="base"
                    id={props.record?.id}
                    embedded
                    disabled={isSaving()}
                    controller={setPermissions}
                  />
                </section>
              </Show>
              <Show when={error()}>
                <ToastMessage tone="error">{error()}</ToastMessage>
              </Show>
              <button
                class="workspace-button"
                type="submit"
                disabled={
                  !session()?.user ||
                  isSaving() ||
                  (recordType() === 'knowledge-base' && !permissions()?.ready)
                }
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
