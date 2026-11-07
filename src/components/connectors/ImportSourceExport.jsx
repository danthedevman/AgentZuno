import Icon from '../Icon.jsx';
import CodeBlock from '../CodeBlock.jsx';
import ToastMessage from '../ToastMessage.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import ImportDestination from './ImportDestination.jsx';
import { Show, createSignal } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';

export default function ImportSourceExport(props) {
  const { workspace } = useWorkspace();
  const [isSaving, setIsSaving] = createSignal(false);
  const [destination, setDestination] = createSignal('existing');
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');
  async function importFile(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get('export');
      if (!file?.size || file.size > 4 * 1024 * 1024)
        throw new Error('Choose a JSON export under 4 MB.');
      let documents;
      try {
        documents = JSON.parse(await file.text());
      } catch {
        throw new Error('The file must contain a valid JSON array.');
      }
      const imported = await api('/api/connections/import', {
        method: 'POST',
        body: JSON.stringify({
          provider: props.app.id,
          documents,
          knowledgeBaseId: form.get('knowledgeBaseId'),
          destination: destination(),
          acceptManagedAccess: true,
          connectionId: props.connection?.id,
        }),
      });
      setMessage(
        `Imported ${imported.sync.documentCount} documents using AgentZuno-managed permissions.`,
      );
      props.onImported?.();
    } catch (error) {
      setError(error.message);
    } finally {
      setIsSaving(false);
    }
  }
  return (
    <details class="source-export-import" open={!props.app.adapterImplemented}>
      <summary>
        {props.app.id === 'custom'
          ? 'Import custom knowledge'
          : `Import a ${props.app.name} export`}
      </summary>
      <p>
        Use a normalized JSON export when a direct adapter or permission sync is unavailable. This
        creates a private snapshot, not a live connection.
      </p>
      <CodeBlock
        language="json"
        code={JSON.stringify(
          [
            {
              id: 'source-id',
              title: 'Article title',
              text: 'Article content',
              url: 'https://source.example/article',
              knowledgeBase: { id: 'source-base', name: 'Source knowledge base' },
            },
          ],
          null,
          2,
        )}
      />
      <ValidatedForm class="create-form" onSubmit={importFile}>
        <label>
          JSON export
          <input
            name="export"
            data-max-bytes={4 * 1024 * 1024}
            type="file"
            accept="application/json,.json"
            required
          />
        </label>
        <ImportDestination value={destination()} onChange={setDestination} />
        <button
          class="workspace-button"
          type="submit"
          disabled={
            isSaving() || (destination() === 'existing' && !workspace()?.knowledgeBases.length)
          }
        >
          <Icon name="download" />

          {isSaving() ? 'Importing…' : 'Import private copy'}
        </button>
      </ValidatedForm>
      <Show when={message()}>
        <ToastMessage tone="success" message={message()} />
      </Show>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
    </details>
  );
}
