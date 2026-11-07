import Dropdown from '../Dropdown.jsx';
import Icon from '../Icon.jsx';
import ToastMessage from '../ToastMessage.jsx';
import { Show, createResource, createSignal } from 'solid-js';
import { api } from '../../services/api.js';
import ValidatedForm from '../ValidatedForm.jsx';
import { useToasts } from '../../context/ToastContext.jsx';

export default function ChatSettings() {
  const [access] = createResource(() => api('/api/helpdesk/access'));
  const [settings, { mutate }] = createResource(() => api('/api/helpdesk/chat-settings'));
  const [saving, setSaving] = createSignal(false);
  const [agentIcon, setAgentIcon] = createSignal('');
  const { notify } = useToasts();
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      mutate(
        await api('/api/helpdesk/chat-settings', {
          method: 'PUT',
          body: JSON.stringify({
            greeting: new FormData(event.currentTarget).get('greeting'),
            agentName: new FormData(event.currentTarget).get('agentName'),
            agentIcon: agentIcon() || settings()?.agentIcon || 'agent',
          }),
        }),
      );
      notify({ tone: 'success', message: 'Chat settings saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Show when={!access.error && access()?.role === 'admin'}>
      <details class="settings-section" name="workspace-settings">
        <summary>Chat</summary>
        <Show
          when={!settings.loading && !settings.error}
          fallback={
            <Show when={settings.error}>
              <ToastMessage tone="error">Chat settings could not be loaded.</ToastMessage>
            </Show>
          }
        >
          <ValidatedForm class="create-form" onSubmit={save}>
            <label>
              Support Agent Name
              <input
                name="agentName"
                required
                maxlength="60"
                value={settings()?.agentName || 'Zuno'}
              />
            </label>
            <label>
              Support Agent Icon
              <Dropdown
                name="agentIcon"
                ariaLabel="Support Agent Icon"
                value={agentIcon() || settings()?.agentIcon || 'agent'}
                onChange={setAgentIcon}
                options={settings()?.iconOptions || [{ value: 'agent', label: 'Assistant' }]}
              />
            </label>
            <div class="support-identity-preview">
              <Icon name={agentIcon() || settings()?.agentIcon || 'agent'} />
              <span>{settings()?.agentName || 'Zuno'}</span>
            </div>
            <label>
              Greeting
              <input
                name="greeting"
                required
                maxlength="200"
                value={settings()?.greeting || 'How can I help you?'}
              />
            </label>
            <button class="workspace-button" disabled={saving()}>
              <Icon name="save" />

              {saving() ? 'Saving…' : 'Save chat settings'}
            </button>
          </ValidatedForm>
        </Show>
      </details>
    </Show>
  );
}
