import { Show, createResource, createSignal, createEffect } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import { confirmAction } from '../../services/confirmations.js';
import ValidatedForm from '../ValidatedForm.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';

export default function AuditSettings() {
  const { access } = useWorkspace(),
    { notify } = useToasts();
  const [open, setOpen] = createSignal(false),
    [busy, setBusy] = createSignal(false);
  const [settings, { refetch }] = createResource(
    () => open() && access()?.role === 'admin',
    () => api('/api/helpdesk/audit-retention'),
  );
  const [enabled, setEnabled] = createSignal(false),
    [days, setDays] = createSignal(365);
  createEffect(() => {
    if (settings()) {
      setEnabled(settings().enabled);
      setDays(settings().retentionDays);
    }
  });
  async function save(event) {
    event.preventDefault();
    const changed = enabled() && (!settings()?.enabled || days() !== settings()?.retentionDays);
    if (
      changed &&
      !(await confirmAction(
        `Automatically and permanently delete completed audit logs older than ${days()} days? Deleted audit history cannot be recovered from the application. Disabling cleanup stops future batches; a batch already running may finish.`,
        'Enable Audit Cleanup',
        'Confirm Cleanup Policy',
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/helpdesk/audit-retention', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: enabled(),
          retentionDays: enabled() ? days() : settings()?.retentionDays || 365,
          version: settings()?.version || 0,
          confirmed: changed,
        }),
      });
      await refetch();
      notify({ tone: 'success', message: 'Audit settings saved.' });
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
        <summary>Audit</summary>
        <Show when={open()}>
          <Show when={settings.error}>
            <ToastMessage tone="error">{settings.error.message}</ToastMessage>
          </Show>
          <Show
            when={!settings.loading && settings()}
            fallback={<Skeleton label="Loading audit settings" lines={3} />}
          >
            <ValidatedForm class="create-form" onSubmit={save}>
              <fieldset class="group-settings">
                <legend>Retention</legend>
                <div class="preference-row">
                  <span>Automatic Cleanup</span>
                  <button
                    type="button"
                    class="toggle-switch"
                    role="switch"
                    aria-label="Automatic Cleanup"
                    aria-checked={enabled()}
                    disabled={busy()}
                    onClick={() => setEnabled(!enabled())}
                  >
                    <span />
                  </button>
                </div>
                <p>
                  {enabled()
                    ? 'Completed audit logs older than the saved retention period are removed automatically. Operational records and workflow history are kept.'
                    : 'Audit logs are retained indefinitely. Automatic cleanup is off.'}
                </p>
                <Show when={enabled()}>
                  <label>
                    Retain Logs (Days)
                    <input
                      type="number"
                      name="retentionDays"
                      required
                      min="1"
                      max="3650"
                      step="1"
                      value={days()}
                      onInput={(event) => setDays(event.currentTarget.valueAsNumber)}
                    />
                  </label>
                </Show>
                <Show when={settings()?.lastCleanupAt}>
                  <p>
                    Last Cleanup: {new Date(settings().lastCleanupAt).toLocaleString()} ·{' '}
                    {settings().lastDeletedCount} records removed
                  </p>
                </Show>
              </fieldset>
              <button class="workspace-button" disabled={busy()}>
                {busy() ? 'Saving…' : 'Save'}
              </button>
            </ValidatedForm>
          </Show>
        </Show>
      </details>
    </Show>
  );
}
