import ToastMessage from './ToastMessage.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import Dropdown from './Dropdown.jsx';
import { Show, createResource, createSignal, createEffect } from 'solid-js';
import { api } from '../services/api.js';
import { useSession } from '../context/SessionContext.jsx';

export default function IdentitySettings() {
  const { session } = useSession();
  const [providers] = createResource(() => api('/api/identity-providers'));
  const [settings, { refetch }] = createResource(
    () => !!session()?.user,
    () => api('/api/settings/identity'),
  );
  const [provider, setProvider] = createSignal('entra');
  const [message, setMessage] = createSignal('');
  const [error, setError] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [autoProvision, setAutoProvision] = createSignal(true);
  createEffect(() => {
    if (!settings.error && settings()) setAutoProvision(settings().settings?.autoProvision ?? true);
  });
  async function save(event) {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    setMessage('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await api('/api/settings/identity', {
        method: 'POST',
        body: JSON.stringify({
          provider: form.get('provider'),
          issuer: form.get('issuer'),
          clientId: form.get('clientId'),
          clientSecret: form.get('clientSecret'),
          enabled: form.get('enabled') === 'on',
          autoProvision: autoProvision(),
        }),
      });
      formElement.querySelector('[name=clientSecret]').value = '';
      await refetch();
      setMessage('Identity provider saved. Link your enterprise identity before using SSO.');
    } catch (error) {
      setError(error.message);
    } finally {
      setIsSaving(false);
    }
  }
  return (
    <section class="identity-settings">
      <Show when={session()?.user} fallback={<p>Sign in to configure enterprise login.</p>}>
        <p>
          Configure OpenID Connect for this workspace. Enterprise identity does not automatically
          grant source or knowledge-base access.
        </p>
        <Show when={settings.error}>
          <ToastMessage tone="error">Could not load identity settings.</ToastMessage>
        </Show>
        <Show when={!settings.loading}>
          <ValidatedForm
            class="create-form"
            onSubmit={save}
            validateField={(field, form) => {
              if (field.name !== 'clientSecret' || field.value) return '';
              const previous = settings()?.settings;
              const values = new FormData(form);
              return !previous?.hasClientSecret ||
                ['issuer', 'clientId', 'provider'].some((key) => values.get(key) !== previous[key])
                ? 'Enter the client secret for this provider.'
                : '';
            }}
          >
            <label>
              Provider
              <Dropdown
                name="provider"
                ariaLabel="Provider"
                defaultValue={settings()?.settings?.provider || 'entra'}
                onChange={setProvider}
                options={(providers() || []).map((item) => ({ value: item.id, label: item.name }))}
              />
            </label>
            <label>
              Issuer URL
              <input
                name="issuer"
                maxlength="500"
                type="url"
                required
                value={settings()?.settings?.issuer || ''}
                placeholder={providers()?.find((item) => item.id === provider())?.issuerHint}
              />
            </label>
            <label>
              Client ID
              <input
                name="clientId"
                maxlength="500"
                required
                value={settings()?.settings?.clientId || ''}
                autocomplete="off"
              />
            </label>
            <label>
              Client secret
              <input
                name="clientSecret"
                maxlength="10000"
                required={!settings()?.settings?.hasClientSecret}
                type="password"
                autocomplete="new-password"
                placeholder={
                  settings()?.settings?.hasClientSecret
                    ? 'Leave blank to keep the saved secret'
                    : 'Client secret'
                }
              />
            </label>
            <label class="checkbox-row">
              <input
                name="enabled"
                type="checkbox"
                checked={settings()?.settings?.enabled || false}
              />
              Enable enterprise sign-in
            </label>
            <div class="preference-row">
              <span>Automatically add employees on SSO sign-in</span>
              <button
                class="toggle-switch"
                type="button"
                role="switch"
                aria-label="Automatically add employees on SSO sign-in"
                aria-checked={autoProvision()}
                onClick={() => setAutoProvision(!autoProvision())}
              >
                <span />
              </button>
            </div>
            <p class="settings-detail">
              Callback URL: <code>{settings()?.callbackUrl}</code>
            </p>
            <p class="settings-detail">
              Custom issuers such as Keycloak must be allowed in OIDC_ALLOWED_ORIGINS on the API
              server.
            </p>
            <Show when={error()}>
              <ToastMessage tone="error">{error()}</ToastMessage>
            </Show>
            <Show when={message()}>
              <ToastMessage tone="success" message={message()} />
            </Show>
            <button class="workspace-button" type="submit" disabled={isSaving()}>
              {isSaving() ? 'Saving…' : 'Save identity provider'}
            </button>
          </ValidatedForm>
          <Show when={settings()?.settings?.enabled}>
            <p>
              <a
                class="workspace-button"
                href={`/api/auth/oidc/start?workspace=${session().user.workspaceId}&link=1`}
              >
                {settings()?.linked ? 'Relink enterprise identity' : 'Link enterprise identity'}
              </a>
            </p>
            <p>
              Enterprise sign-in link:{' '}
              <code>
                {window.location.origin}/login?workspace={session()?.user?.workspaceId}
              </code>
            </p>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
