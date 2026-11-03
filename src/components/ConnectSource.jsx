import { displayLabel } from '../services/displayLabels.js';
import ToastMessage from './ToastMessage.jsx';
import SourceKnowledgeBases from './SourceKnowledgeBases.jsx';
import A from './WorkspaceLink.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import ImportApiEndpoint from './ImportApiEndpoint.jsx';
import ImportDestination from './ImportDestination.jsx';
import Dropdown from './Dropdown.jsx';
import ImportSourceExport from './ImportSourceExport.jsx';
import { For, Show, createSignal, createResource, onCleanup } from 'solid-js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { api } from '../services/api.js';

export default function ConnectSource(props) {
  const { workspace, refresh } = useWorkspace();
  const { session } = useSession();
  const [connections, { refetch }] = createResource(
    () => !!session()?.user,
    () => api('/api/connections'),
  );
  const [selectedMode, setMode] = createSignal(props.connection?.permissionMode || 'source');
  const canEnforceSource = () => props.app.sourcePermissionsSupported && authType() === 'oauth';
  const mode = () => (canEnforceSource() ? selectedMode() : 'managed');
  const [selectedAuthType, setAuthType] = createSignal(props.connection?.authType || '');
  const methods = () => props.app.authenticationMethods || [];
  const authType = () =>
    methods().some((method) => method.id === selectedAuthType())
      ? selectedAuthType()
      : methods()[0]?.id || 'oauth';
  const credentialLabel = () =>
    methods().find((method) => method.id === authType())?.credentialLabel || 'Access token';
  const fields = () =>
    (props.app.connectionFields || []).filter(
      (field) => !field.when || field.when.includes(authType()),
    );
  const [destination, setDestination] = createSignal(props.connection?.destination || 'existing');
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const ownConnections = () =>
    (connections() || []).filter((item) => item.provider === props.app.id);
  let timer;
  let validateConnection;
  onCleanup(() => clearTimeout(timer));
  async function connectOAuth(event) {
    const form = event.currentTarget.form;
    if (!validateConnection((field) => field.name !== 'accessToken')) return;
    setError('');
    setIsSaving(true);
    try {
      const values = new FormData(form);
      const result = await api('/api/connections/oauth/start', {
        method: 'POST',
        body: JSON.stringify({
          provider: props.app.id,
          cloudId: values.get('cloudId'),
          knowledgeBaseId: values.get('knowledgeBaseId'),
          destination: destination(),
          permissionMode: mode(),
        }),
      });
      window.location.assign(result.url);
    } catch (error) {
      setError(error.message);
      setIsSaving(false);
    }
  }
  async function connect(event) {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    setMessage('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api(`/api/connections${props.connection ? '/' + props.connection.id : ''}`, {
        method: props.connection ? 'PATCH' : 'POST',
        body: JSON.stringify({
          provider: props.app.id,
          tenant: form.get('tenant'),
          cloudId: form.get('cloudId'),
          namespace: form.get('namespace'),
          accessToken: form.get('accessToken'),
          knowledgeBaseId: form.get('knowledgeBaseId'),
          destination: destination(),
          permissionMode: mode(),
          acceptManagedAccess: mode() === 'managed',
          authType: authType(),
          username: form.get('username'),
          config: Object.fromEntries(fields().map((field) => [field.name, form.get(field.name)])),
        }),
      });
      formElement.querySelector('[name=accessToken]').value = '';
      setMessage('Connection verified and saved. Start an import below.');
      await refetch();
      await refresh();
    } catch (error) {
      setError(error.message);
    } finally {
      setIsSaving(false);
    }
  }
  async function action(id, name) {
    setError('');
    try {
      await api(`/api/connections/${id}/${name}`, { method: 'POST', body: '{}' });
      await refetch();
      await refresh();
      if (name === 'sync') {
        const poll = async () => {
          await refetch();
          await refresh();
          if (connections()?.some((item) => item.id === id && item.sync?.status === 'Syncing'))
            timer = setTimeout(poll, 2000);
        };
        timer = setTimeout(poll, 1000);
      }
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <section class="connect-source">
      <Show when={session()?.user} fallback={<p>Sign in to configure a source connection.</p>}>
        <For each={ownConnections()}>
          {(connection) => (
            <article class="source-connection-status">
              <h2>{connection.sourcePrincipal?.name || connection.provider}</h2>
              <SourceKnowledgeBases connection={connection} />
              <dl class="agent-details">
                <dt>Status</dt>
                <dd>
                  {connection.authType === 'export' && connection.status === 'Connected'
                    ? 'Imported snapshot'
                    : displayLabel(connection.status)}
                </dd>
                <dt>Permissions</dt>
                <dd>
                  {connection.permissionMode === 'source'
                    ? 'Source enforced · verified at every query'
                    : 'AgentZuno managed · private owner access'}
                </dd>
                <dt>Import</dt>
                <dd>
                  {displayLabel(connection.sync?.status)} · {connection.sync?.documentCount || 0}{' '}
                  documents
                </dd>
                <dt>Edit</dt>
                <dd>
                  <A href={`/workspace/integrations/${connection.provider}/${connection.id}/edit`}>
                    Edit connection
                  </A>
                </dd>
                <dt>Last complete sync</dt>
                <dd>
                  {connection.sync?.lastAt
                    ? new Date(connection.sync.lastAt).toLocaleString()
                    : 'Never'}
                </dd>
              </dl>
              <Show when={connection.sync?.error}>
                <ToastMessage tone="error">{connection.sync.error}</ToastMessage>
              </Show>
              <Show when={connection.status === 'Connected'}>
                <div class="connection-actions">
                  <button
                    class="workspace-button small"
                    type="button"
                    disabled={
                      connection.sync?.status === 'Syncing' || connection.authType === 'export'
                    }
                    onClick={() => action(connection.id, 'sync')}
                  >
                    Import now
                  </button>
                  <button
                    class="card-link"
                    type="button"
                    onClick={() => action(connection.id, 'disconnect')}
                  >
                    Disconnect
                  </button>
                </div>
              </Show>
            </article>
          )}
        </For>
        <Show
          when={props.app.adapterImplemented}
          fallback={
            <p>
              {props.app.id === 'custom'
                ? 'Import a normalized JSON knowledge export below using AgentZuno-managed permissions.'
                : 'This app’s direct adapter is not implemented. You can import an authorized export below using AgentZuno-managed permissions.'}
            </p>
          }
        >
          <h2>{props.connection ? 'Edit connection' : 'Connect source'}</h2>
          <ValidatedForm
            class="create-form"
            validationRef={(validate) => {
              validateConnection = validate;
            }}
            onSubmit={connect}
          >
            <Show when={props.app.id === 'servicenow'}>
              <p>
                This adapter requires the authenticated AgentZuno knowledge permission bridge
                installed by your ServiceNow administrator.
              </p>
            </Show>
            <label>
              Authentication
              <Dropdown
                ariaLabel="Authentication"
                value={authType()}
                onChange={setAuthType}
                options={methods().map((method) => ({ value: method.id, label: method.label }))}
              />
            </label>
            <For each={fields()}>
              {(field) => (
                <label>
                  {field.label}
                  <Show
                    when={field.options}
                    fallback={
                      <input
                        name={field.name}
                        type={field.type || 'text'}
                        required={field.required}
                        pattern={field.pattern}
                        value={props.connection?.config?.[field.name] || field.defaultValue || ''}
                        maxlength="254"
                      />
                    }
                  >
                    <Dropdown
                      name={field.name}
                      ariaLabel={field.label}
                      defaultValue={props.connection?.config?.[field.name] || field.defaultValue}
                      options={field.options}
                    />
                  </Show>
                </label>
              )}
            </For>
            <label>
              {credentialLabel()}
              <input
                name="accessToken"
                maxlength="10000"
                type="password"
                autocomplete="new-password"
                required={!props.connection}
                placeholder={props.connection ? 'Leave blank to keep the saved credential' : ''}
              />
              <small>Credentials are encrypted on the server and never sent to an agent.</small>
            </label>
            <ImportDestination
              value={destination()}
              onChange={setDestination}
              knowledgeBaseId={props.connection?.knowledgeBaseId}
            />
            <label>
              Permission mode
              <Dropdown
                ariaLabel="Permission mode"
                value={mode()}
                onChange={setMode}
                readOnly={!canEnforceSource()}
                options={[
                  ...(canEnforceSource() ? [{ value: 'source', label: 'Source enforced' }] : []),
                  { value: 'managed', label: 'AgentZuno managed' },
                ]}
              />
            </label>
            <Show when={!props.app.sourcePermissionsSupported}>
              <p>
                This app’s API does not provide a verified end-user permission check in this
                adapter. Imported copies use private AgentZuno-managed access.
              </p>
            </Show>
            <Show when={authType() === 'oauth' && ['notion', 'confluence'].includes(props.app.id)}>
              <button
                class="workspace-button"
                type="button"
                disabled={
                  isSaving() ||
                  (destination() === 'existing' && !workspace()?.knowledgeBases.length)
                }
                onClick={connectOAuth}
              >
                Authorize with {props.app.name}
              </button>
              <small>Or enter an existing delegated OAuth token above.</small>
            </Show>
            <button
              class="workspace-button"
              type="submit"
              disabled={
                isSaving() || (destination() === 'existing' && !workspace()?.knowledgeBases.length)
              }
            >
              {isSaving()
                ? 'Verifying…'
                : props.connection
                  ? 'Save connection'
                  : 'Verify and connect'}
            </button>
          </ValidatedForm>
        </Show>
        <Show when={props.app.id === 'custom'}>
          <ImportApiEndpoint
            onImported={() => {
              refetch();
              refresh();
            }}
          />
        </Show>
        <ImportSourceExport
          app={props.app}
          onImported={() => {
            refetch();
            refresh();
          }}
        />
      </Show>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
      <Show when={message()}>
        <ToastMessage tone="success" message={message()} />
      </Show>
    </section>
  );
}
