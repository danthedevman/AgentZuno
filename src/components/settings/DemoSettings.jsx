import Icon from '../Icon.jsx';
import { Show, createResource, createSignal } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import { confirmAction } from '../../services/confirmations.js';
import Dropdown from '../Dropdown.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';
export default function DemoSettings() {
  const { access, refreshAccess } = useWorkspace(),
    { notify } = useToasts();
  const [settings, { mutate }] = createResource(
    () => access()?.role === 'admin',
    () => api('/api/helpdesk/demo/settings'),
  );
  const [industry, setIndustry] = createSignal('tech'),
    [busy, setBusy] = createSignal(false);
  async function change(action) {
    if (
      action === 'load' &&
      !access()?.canApprove &&
      !(await confirmAction(
        'Load demo records and approvals? This adds you to the demo assignment group and enables approval permission for your account. Removal restores that permission if you have not changed your membership afterward.',
        'Load Demo Data',
        'Load Demo Data',
      ))
    )
      return;
    if (action === 'remove') {
      setBusy(true);
      try {
        const preview = await api('/api/helpdesk/demo/removal-preview');
        const retained = preview.retained.length
          ? ` ${preview.retained.length} referenced records will become real records to preserve existing work: ${preview.retained
              .map((item) => item.name)
              .slice(0, 8)
              .join(', ')}.`
          : '';
        if (
          !(await confirmAction(
            `Remove tagged demo records, including requests submitted from demo workflows? Real records and audit history will be retained.${retained}`,
            'Remove Demo Data',
            'Remove Demo Data',
          ))
        )
          return;
      } catch (error) {
        notify({ tone: 'error', message: error.message });
        return;
      } finally {
        setBusy(false);
      }
    }
    setBusy(true);
    try {
      const result = await api('/api/helpdesk/demo/settings', {
        method: 'PUT',
        body: JSON.stringify({
          action,
          ...(action === 'load' ? { enableApprovals: true } : {}),
          industry: action === 'remove' ? settings().industry : industry(),
          ...(action === 'remove' ? { confirmed: true } : {}),
        }),
      });
      mutate(result);
      await refreshAccess?.();
      window.dispatchEvent(new Event('demo-settings-changed'));
      notify({
        tone: 'success',
        message:
          action === 'load' ? 'Demo records loaded into this workspace.' : 'Demo records removed.',
      });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Show when={access()?.role === 'admin'}>
      <details class="settings-section" name="workspace-settings" id="demo-data">
        <summary>Demo Data</summary>
        <p>
          Load fictional, tagged records into this workspace to try catalog workflows, requests,
          knowledge and assets. Connect an AI provider to chat with the demo knowledge and
          workflows. Demo workflows route internally without sending external messages.
        </p>
        <Show when={settings.loading}>
          <Skeleton lines={2} />
        </Show>
        <Show when={settings.error}>
          <ToastMessage tone="error">{settings.error.message}</ToastMessage>
        </Show>
        <Show when={settings()}>
          <div class="demo-data-controls">
            <label>
              Industry
              <Dropdown
                ariaLabel="Demo industry"
                value={settings().loaded ? settings().industry : industry()}
                options={settings().industries}
                disabled={busy() || settings().loaded}
                onChange={setIndustry}
              />
            </label>
            <Show when={settings().loaded}>
              <p role="status">Demo data is loaded in this workspace.</p>
            </Show>
            <Show when={settings().state === 'incomplete'}>
              <p role="status">
                The previous operation was interrupted. Retry loading or remove the partial dataset.
              </p>
            </Show>
            <div class="helpdesk-actions">
              <button class="workspace-button" disabled={busy()} onClick={() => change('load')}>
                <Icon name="download" />

                {busy() ? 'Processing…' : 'Load Demo Data'}
              </button>
              <button
                class="workspace-button secondary"
                disabled={busy() || !settings().loaded}
                onClick={() => change('remove')}
              >
                Remove Demo Data
              </button>
            </div>
          </div>
        </Show>
      </details>
    </Show>
  );
}
