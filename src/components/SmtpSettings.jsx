import { Show, createResource, createSignal, createEffect } from 'solid-js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { api } from '../services/api.js';
import { useToasts } from '../context/ToastContext.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import Dropdown from './Dropdown.jsx';
import Skeleton from './Skeleton.jsx';
export default function SmtpSettings() {
  const { access } = useWorkspace();
  const { notify } = useToasts();
  const [open, setOpen] = createSignal(false);
  const [settings, { refetch }] = createResource(
    () => open() && access()?.role === 'admin',
    () => api('/api/helpdesk/smtp'),
  );
  const [fields, setFields] = createSignal({
    host: '',
    from: '',
    username: '',
    password: '',
    port: 587,
  });
  const [busy, setBusy] = createSignal(false);
  createEffect(() => {
    if (settings()) setFields({ ...settings(), password: '' });
  });
  const change = (key, value) => setFields((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const value = fields();
      await api('/api/helpdesk/smtp', {
        method: 'PUT',
        body: JSON.stringify({
          host: value.host,
          from: value.from,
          username: value.username,
          password: value.password,
          port: value.port,
          version: settings()?.version || 0,
        }),
      });
      await refetch();
      notify({ tone: 'success', message: 'SMTP settings saved' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    try {
      await api('/api/helpdesk/smtp/test', { method: 'POST', body: '{}' });
      notify({ tone: 'success', message: 'SMTP connection verified' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Show when={access()?.role === 'admin'}>
      <details
        class="settings-section"
        name="workspace-settings"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Outgoing Email (SMTP)</summary>
        <Show when={open()}>
          <Show
            when={!settings.loading && settings()}
            fallback={<Skeleton label="Loading SMTP settings" lines={5} />}
          >
            <ValidatedForm class="create-form" onSubmit={save}>
              <label>
                SMTP Host
                <input
                  required
                  maxlength="253"
                  value={fields().host}
                  onInput={(event) => change('host', event.currentTarget.value)}
                />
              </label>
              <label>
                TLS Port
                <Dropdown
                  ariaLabel="SMTP TLS port"
                  value={String(fields().port)}
                  options={[
                    { value: '587', label: '587 · STARTTLS' },
                    { value: '465', label: '465 · TLS' },
                  ]}
                  onChange={(value) => change('port', Number(value))}
                />
              </label>
              <label>
                Sender Email
                <input
                  type="email"
                  required
                  maxlength="254"
                  value={fields().from}
                  onInput={(event) => change('from', event.currentTarget.value)}
                />
              </label>
              <label>
                Username
                <input
                  maxlength="2000"
                  autocomplete="off"
                  value={fields().username}
                  onInput={(event) => change('username', event.currentTarget.value)}
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  maxlength="2000"
                  autocomplete="new-password"
                  placeholder={
                    settings()?.hasPassword ? 'Saved password · leave blank to keep' : ''
                  }
                  value={fields().password}
                  onInput={(event) => change('password', event.currentTarget.value)}
                />
              </label>
              <div class="helpdesk-actions">
                <button class="workspace-button" disabled={busy()}>
                  {busy() ? 'Working…' : 'Save'}
                </button>
                <button
                  type="button"
                  class="workspace-button secondary"
                  disabled={busy() || !settings()?.version}
                  onClick={test}
                >
                  Test Connection
                </button>
              </div>
            </ValidatedForm>
          </Show>
        </Show>
      </details>
    </Show>
  );
}
