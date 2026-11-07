import Icon from '../Icon.jsx';
import ToastMessage from '../ToastMessage.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import { Show, createSignal } from 'solid-js';
import Dropdown from '../Dropdown.jsx';
import ImportDestination from './ImportDestination.jsx';
import { api } from '../../services/api.js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';

export default function ImportApiEndpoint(props) {
  const { workspace } = useWorkspace();
  const [authentication, setAuthentication] = createSignal('none');
  const [destination, setDestination] = createSignal('existing');
  const [isSaving, setIsSaving] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');

  async function importEndpoint(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIsSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api('/api/connections/import-endpoint', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: form.get('endpoint'),
          authentication: authentication(),
          secret: form.get('secret'),
          username: form.get('username'),
          headerName: form.get('headerName'),
          destination: destination(),
          knowledgeBaseId: form.get('knowledgeBaseId'),
          acceptManagedAccess: true,
          connectionId: props.connection?.id,
        }),
      });
      const credential = formElement.elements.namedItem('secret');
      if (credential) credential.value = '';
      setMessage(
        `Imported ${result.sync.documentCount} documents using AgentZuno-managed permissions.`,
      );
      props.onImported?.();
    } catch (error) {
      setError(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section class="source-export-import">
      <h2>Import from an API</h2>
      <p>
        Scan a public HTTPS JSON endpoint to create a private snapshot. Credentials are used for
        this scan only and are not saved. Source permissions and scheduled sync are not supported.
      </p>
      <p>
        Return an array of documents in the JSON export format below, or an object with{' '}
        <code>documents</code> and an optional <code>next</code> URL on the same origin. Limits: 20
        pages, 1,000 documents, and 4 MB total.
      </p>
      <ValidatedForm class="create-form" onSubmit={importEndpoint}>
        <label>
          API endpoint
          <input
            name="endpoint"
            type="url"
            placeholder="https://example.com/api/knowledge"
            maxLength={2000}
            required
          />
        </label>
        <label>
          Authentication
          <Dropdown
            ariaLabel="API authentication"
            value={authentication()}
            onChange={setAuthentication}
            options={[
              { value: 'none', label: 'None' },
              { value: 'bearer', label: 'Bearer token' },
              { value: 'api-key', label: 'API key' },
              { value: 'basic', label: 'Basic authentication' },
            ]}
          />
        </label>
        <Show when={authentication() === 'api-key'}>
          <label>
            API key header
            <input
              name="headerName"
              pattern="[a-zA-Z][a-zA-Z0-9-]{0,63}"
              placeholder="X-API-Key"
              maxLength={64}
              required
            />
          </label>
        </Show>
        <Show when={authentication() === 'basic'}>
          <label>
            Username
            <input name="username" maxLength={254} autoComplete="off" required />
          </label>
        </Show>
        <Show when={authentication() !== 'none'}>
          <label>
            {authentication() === 'basic' ? 'Password' : 'Token or API key'}
            <input name="secret" type="password" maxLength={4096} autoComplete="off" required />
          </label>
        </Show>
        <ImportDestination value={destination()} onChange={setDestination} />
        <button
          class="workspace-button"
          type="submit"
          disabled={
            isSaving() || (destination() === 'existing' && !workspace()?.knowledgeBases.length)
          }
        >
          <Icon name="download" />

          {isSaving() ? 'Scanning…' : 'Scan and import private copy'}
        </button>
      </ValidatedForm>
      <Show when={message()}>
        <ToastMessage tone="success" message={message()} />
      </Show>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
    </section>
  );
}
