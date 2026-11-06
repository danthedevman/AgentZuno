import A from '../WorkspaceLink.jsx';
import SlackUserReview from './SlackUserReview.jsx';
import { confirmAction } from '../../services/confirmations.js';
import { Index, Show, createResource, createSignal } from 'solid-js';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import ReferenceLookup from '../ReferenceLookup.jsx';
export default function SlackBotSettings(props) {
  const { notify } = useToasts();
  const [enabled, setEnabled] = createSignal(props.channel.bot.enabled);
  const [bindings, setBindings] = createSignal(props.channel.bot.identityBindings || []);
  const [users] = createResource(
    () => !!props.manageUsers,
    () => api('/api/helpdesk/reference-records'),
  );
  const [bindingPage, setBindingPage] = createSignal(1);
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
      notify({
        tone: 'success',
        message: props.manageUsers ? 'Slack user links saved.' : 'Slack bot settings saved.',
      });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Show when={props.manageUsers}>
        <SlackUserReview
          users={users()?.users || []}
          disabled={
            busy() ||
            JSON.stringify(bindings()) !==
              JSON.stringify(props.channel.bot.identityBindings || []) ||
            enabled() !== props.channel.bot.enabled
          }
          onSaved={async () => {
            await props.onSaved();
            setBindings(props.channel.bot.identityBindings || []);
          }}
        />
      </Show>
      <ValidatedForm class="create-form" onSubmit={save}>
        <Show when={!props.manageUsers}>
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
            Invite Zuno to a channel and mention it, or message it directly. Channel replies are
            visible only to the requester. Link Slack member IDs to workspace users to apply their
            existing account and SSO permissions. Email matches require review; unmatched users can
            link their own account from a private bot response.
          </p>
          <A class="workspace-button secondary small" href="/workspace/connectors/slack/users">
            Manage Slack Users
          </A>
        </Show>
        <Show when={props.manageUsers}>
          <Index each={bindings().slice((bindingPage() - 1) * 20, bindingPage() * 20)}>
            {(binding, index) => (
              <fieldset class="workflow-form-field create-form">
                <legend>User Link {(bindingPage() - 1) * 20 + index + 1}</legend>
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
                          i === (bindingPage() - 1) * 20 + index
                            ? { ...item, slackUserId: event.currentTarget.value }
                            : item,
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
                      items.map((item, i) =>
                        i === (bindingPage() - 1) * 20 + index ? { ...item, userId } : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  class="workspace-button secondary small"
                  onClick={async () => {
                    if (await confirmAction('Remove this Slack user link?')) {
                      setBindings((items) =>
                        items.filter((_, i) => i !== (bindingPage() - 1) * 20 + index),
                      );
                      setBindingPage(
                        Math.max(1, Math.min(bindingPage(), Math.ceil(bindings().length / 20))),
                      );
                    }
                  }}
                >
                  Remove Link
                </button>
              </fieldset>
            )}
          </Index>
          <Show when={bindings().length > 20}>
            <div class="helpdesk-actions">
              <button
                type="button"
                class="workspace-button secondary small"
                disabled={bindingPage() === 1}
                onClick={() => setBindingPage(bindingPage() - 1)}
              >
                Previous Links
              </button>
              <span>
                Page {bindingPage()} of {Math.ceil(bindings().length / 20)}
              </span>
              <button
                type="button"
                class="workspace-button secondary small"
                disabled={bindingPage() * 20 >= bindings().length}
                onClick={() => setBindingPage(bindingPage() + 1)}
              >
                Next Links
              </button>
            </div>
          </Show>
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={bindings().length >= 1000}
            onClick={() => {
              setBindingPage(Math.ceil((bindings().length + 1) / 20));
              setBindings([...bindings(), { slackUserId: '', userId: '' }]);
            }}
          >
            Link User
          </button>
        </Show>
        <button class="workspace-button small" disabled={busy() || !!users.error}>
          {props.manageUsers ? 'Save User Links' : 'Save Bot Settings'}
        </button>
      </ValidatedForm>
    </>
  );
}
