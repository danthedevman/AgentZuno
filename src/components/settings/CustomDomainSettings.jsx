import { Show, createResource, createSignal } from 'solid-js';
import { api } from '../../services/api.js';
import ValidatedForm from '../ValidatedForm.jsx';
import { useToasts } from '../../context/ToastContext.jsx';
import ToastMessage from '../ToastMessage.jsx';

export default function CustomDomainSettings() {
  const [access] = createResource(() => api('/api/helpdesk/access'));
  const [settings, { mutate, refetch }] = createResource(
    () => !access.error && access()?.role === 'admin',
    () => api('/api/helpdesk/domain'),
  );
  const [busy, setBusy] = createSignal(false);
  const { notify } = useToasts();
  async function action(path, method, body, message) {
    setBusy(true);
    try {
      mutate(
        await api(`/api/helpdesk/domain${path}`, {
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      notify({ tone: 'success', message });
    } catch (error) {
      if (!error.canceled) notify({ tone: 'error', message: error.message });
      await refetch().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <Show when={!access.error && access()?.role === 'admin'}>
      <details class="settings-section" name="workspace-settings">
        <summary>Custom Domain</summary>
        <Show when={settings.error}>
          <ToastMessage tone="error">Could not load custom domain settings.</ToastMessage>
        </Show>
        <Show when={!settings.loading && !settings.error}>
          <ValidatedForm
            class="create-form"
            onSubmit={(event) => {
              event.preventDefault();
              action(
                '',
                'PUT',
                { domain: new FormData(event.currentTarget).get('domain') },
                'Domain saved. Add the DNS records below.',
              );
            }}
          >
            <label>
              Portal Domain
              <input
                name="domain"
                required
                maxlength="253"
                placeholder="help.company.com"
                value={settings()?.domain || ''}
              />
            </label>
            <button class="workspace-button small" disabled={busy()}>
              Save Domain
            </button>
          </ValidatedForm>
          <Show when={settings()?.domain}>
            <p class="activity-status">
              {settings().enabled
                ? 'Enabled'
                : settings().verified
                  ? 'Ownership Verified'
                  : 'Awaiting DNS Verification'}
            </p>
            <dl class="domain-dns-records">
              <dt>TXT Name</dt>
              <dd>
                <code>{settings().txtName}</code>
              </dd>
              <dt>TXT Value</dt>
              <dd>
                <code>{settings().txtValue}</code>
              </dd>
              <dt>CNAME Name</dt>
              <dd>
                <code>{settings().domain}</code>
              </dd>
              <dt>CNAME Target</dt>
              <dd>
                {settings().target ||
                  'Set CUSTOM_DOMAIN_TARGET on the server to your public app hostname.'}
              </dd>
            </dl>
            <p>
              Add both DNS records at your domain provider. Configure HTTPS for this hostname at
              your reverse proxy or hosting provider. Domain verification does not install a TLS
              certificate.
            </p>
            <Show when={!settings().hostingConfigured}>
              <p>
                Before enabling the portal, configure CUSTOM_DOMAIN_TARGET and COOKIE_SECURE=true on
                the server.
              </p>
            </Show>
            <div class="helpdesk-actions">
              <button
                type="button"
                class="workspace-button secondary small"
                disabled={busy()}
                onClick={() => action('/verify', 'POST', {}, 'Domain ownership verified.')}
              >
                Verify DNS
              </button>
              <button
                type="button"
                class="workspace-button small"
                disabled={
                  busy() ||
                  (!settings().enabled &&
                    (!settings().verified || !settings().dnsReady || !settings().hostingConfigured))
                }
                onClick={() =>
                  action(
                    '/enabled',
                    'PUT',
                    { enabled: !settings().enabled },
                    settings().enabled ? 'Portal disabled.' : 'Portal enabled.',
                  )
                }
              >
                {settings().enabled ? 'Disable Portal' : 'Enable Portal'}
              </button>
              <button
                type="button"
                class="workspace-button secondary small"
                disabled={busy()}
                onClick={() => action('', 'DELETE', undefined, 'Custom domain removed.')}
              >
                Remove Domain
              </button>
            </div>
          </Show>
        </Show>
      </details>
    </Show>
  );
}
