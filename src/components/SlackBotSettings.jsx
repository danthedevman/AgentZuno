import { confirmAction } from '../services/confirmations.js';
import { Index, Show, createResource, createSignal } from 'solid-js';
import { api } from '../services/api.js';
import { useToasts } from '../context/ToastContext.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import ReferenceLookup from './ReferenceLookup.jsx';
export default function SlackBotSettings(props) {
  const { notify } = useToasts();
  const [enabled, setEnabled] = createSignal(props.channel.bot.enabled);
  const [bindings, setBindings] = createSignal(props.channel.bot.identityBindings || []);
  const [users] = createResource(() => api('/api/helpdesk/reference-records'));
  const [busy, setBusy] = createSignal(false);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/helpdesk/channels/slack/bot', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: enabled(),
          identityBindings: bindings(),
          version: props.channel.bot.version,
        }),
      });
      await props.onSaved();
      notify({ tone: 'success', message: 'Slack bot settings saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <ValidatedForm class="create-form" onSubmit={save}>
      <p>{props.channel.bot.teamName}</p>
      <div class="preference-row">
        <span>Enable Zuno Bot</span>
        <button
          type="button"
          class="toggle-switch"
          role="switch"
          aria-label="Enable Zuno Bot"
          aria-checked={enabled()}
          onClick={() => setEnabled(!enabled())}
        >
          <span />
        </button>
      </div>
      <p>
        Invite Zuno to a channel and mention it, or message it directly. Channel replies are visible
        only to the requester. Link Slack member IDs to workspace users to apply their existing
        account and SSO permissions. Email addresses are never matched automatically.
      </p>
      <Index each={bindings()}>
        {(binding, index) => (
          <fieldset class="workflow-form-field create-form">
            <legend>User Link {index + 1}</legend>
            <label>
              Slack Member ID
              <input
                required
                maxlength="40"
                pattern="[UW][A-Z0-9]{2,39}"
                value={binding().slackUserId}
                onInput={(event) =>
                  setBindings((items) =>
                    items.map((item, i) =>
                      i === index ? { ...item, slackUserId: event.currentTarget.value } : item,
                    ),
                  )
                }
              />
            </label>
            <ReferenceLookup
              label="Workspace User"
              required
              name={`slack-user-${index}`}
              value={binding().userId}
              options={
                !users.error
                  ? (users()?.users || []).map((user) => ({
                      value: user.id,
                      label: user.name,
                      href: `/workspace/users/${user.id}`,
                    }))
                  : []
              }
              disabled={users.loading || !!users.error}
              onChange={(userId) =>
                setBindings((items) =>
                  items.map((item, i) => (i === index ? { ...item, userId } : item)),
                )
              }
            />
            <button
              type="button"
              class="workspace-button secondary small"
              onClick={async () => {
                if (await confirmAction('Remove this Slack user link?'))
                  setBindings((items) => items.filter((_, i) => i !== index));
              }}
            >
              Remove Link
            </button>
          </fieldset>
        )}
      </Index>
      <button
        type="button"
        class="workspace-button secondary small"
        disabled={bindings().length >= 200}
        onClick={() => setBindings([...bindings(), { slackUserId: '', userId: '' }])}
      >
        Link User
      </button>
      <button class="workspace-button small" disabled={busy() || !!users.error}>
        Save Bot Settings
      </button>
    </ValidatedForm>
  );
}
