import { Index, createResource, createSignal } from 'solid-js';
import ValidatedForm from '../ValidatedForm.jsx';
import ReferenceLookup from '../ReferenceLookup.jsx';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import { confirmAction } from '../../services/confirmations.js';
export default function TeamsBotSettings(props) {
  const initial = () => props.channel.teamsBot;
  const [tenantId, setTenantId] = createSignal(initial()?.tenantId || '');
  const [enabled, setEnabled] = createSignal(initial()?.enabled || false);
  const [bindings, setBindings] = createSignal(initial()?.identityBindings || []);
  const [busy, setBusy] = createSignal(false);
  const [users] = createResource(() => api('/api/helpdesk/reference-records'));
  const { notify } = useToasts();
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/helpdesk/channels/teams/bot', {
        method: 'PUT',
        body: JSON.stringify({
          tenantId: tenantId(),
          enabled: enabled(),
          identityBindings: bindings(),
          version: initial()?.version || 0,
        }),
      });
      await props.onSaved();
      notify({ tone: 'success', message: 'Teams bot settings saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <ValidatedForm class="create-form" onSubmit={save}>
      <h2>Teams Bot</h2>
      <label>
        Tenant ID
        <input
          required
          maxlength="36"
          value={tenantId()}
          onInput={(event) => setTenantId(event.currentTarget.value.trim())}
        />
      </label>
      <label>
        Teams Events URL
        <input readOnly value={initial()?.eventsUrl || ''} />
      </label>
      <fieldset class="group-settings">
        <legend>Bot Settings</legend>
        <div class="preference-row">
          <span>Enable Zuno Bot</span>
          <button
            type="button"
            role="switch"
            class="toggle-switch"
            aria-label="Enable Teams Bot"
            aria-checked={enabled()}
            onClick={() => setEnabled(!enabled())}
          >
            <span />
          </button>
        </div>
      </fieldset>
      <Index each={bindings()}>
        {(binding, index) => (
          <fieldset class="workflow-form-field create-form">
            <legend>User Link {index + 1}</legend>
            <label>
              Entra Object ID
              <input
                required
                maxlength="36"
                value={binding().aadObjectId}
                onInput={(event) =>
                  setBindings(
                    bindings().map((item, i) =>
                      i === index
                        ? { ...item, aadObjectId: event.currentTarget.value.trim() }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <ReferenceLookup
              name={`teams-user-${index}`}
              label="Workspace User"
              required
              options={
                !users.error
                  ? (users()?.users || []).map((user) => ({
                      value: user.id,
                      label: user.name,
                      href: `/workspace/users/${user.id}`,
                    }))
                  : []
              }
              value={binding().userId}
              onChange={(userId) =>
                setBindings(bindings().map((item, i) => (i === index ? { ...item, userId } : item)))
              }
            />
            <button
              type="button"
              class="workspace-button secondary small"
              onClick={async () => {
                if (
                  await confirmAction(
                    'Remove this Teams identity link?',
                    'Remove User Link',
                    'Remove',
                  )
                )
                  setBindings(bindings().filter((_, i) => i !== index));
              }}
            >
              Remove User Link
            </button>
          </fieldset>
        )}
      </Index>
      <div class="helpdesk-actions">
        <button
          type="button"
          class="workspace-button secondary small"
          onClick={() => setBindings([...bindings(), { aadObjectId: '', userId: '' }])}
        >
          Add User Link
        </button>
        <button class="workspace-button small" disabled={busy() || !props.channel.configured}>
          {busy() ? 'Saving…' : 'Save Bot Settings'}
        </button>
      </div>
    </ValidatedForm>
  );
}
