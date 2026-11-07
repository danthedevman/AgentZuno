import Icon from '../../components/Icon.jsx';
import { publicAsset } from '../../services/public/publicAsset.js';
import { A, useNavigate } from '@solidjs/router';
import { createResource, createSignal, Show } from 'solid-js';
import { api } from '../../services/api.js';
import Dropdown from '../../components/Dropdown.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import { useToasts } from '../../context/ToastContext.jsx';
export default function DatabaseSetupPage() {
  const navigate = useNavigate(),
    { notify } = useToasts();
  const [status] = createResource(() => api('/api/installation/database'));
  const [provider, setProvider] = createSignal('mongodb');
  const [mode, setMode] = createSignal('bundled');
  const [token, setToken] = createSignal(''),
    [connection, setConnection] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/installation/database', {
        method: 'POST',
        body: JSON.stringify({
          provider: provider(),
          mode: mode(),
          token: token(),
          ...(mode() === 'custom' ? { connectionString: connection() } : {}),
        }),
      });
      setToken('');
      setConnection('');
      navigate('/register', { replace: true });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <main class="login-page database-setup-page">
      <A class="login-brand" href="/">
        <img src={publicAsset('/agentzuno-wordmark.svg')} alt="AgentZuno" width="240" height="60" />
      </A>
      <section class="login-panel">
        <h1>Choose Your Database</h1>
        <p>
          Set up storage for this installation before creating the first account. All workspaces use
          this database.
        </p>
        <Show when={!status.loading} fallback={<Skeleton lines={3} />}>
          <Show
            when={!status()?.configured}
            fallback={
              <A class="workspace-button" href="/register">
                <Icon name="arrow" />
                Continue to Register
              </A>
            }
          >
            <ValidatedForm onSubmit={submit}>
              <label>
                Setup Token
                <input
                  type="password"
                  name="setupToken"
                  required
                  minlength="64"
                  maxlength="64"
                  autocomplete="off"
                  value={token()}
                  onInput={(event) => setToken(event.currentTarget.value)}
                />
              </label>
              <p>
                Retrieve the token on your server:{' '}
                <code>docker compose exec api cat /app/installation/setup.token</code>.{' '}
                <A href="/docs#database-setup" target="_blank" rel="noopener noreferrer">
                  Database setup guide →
                </A>
              </p>
              <label>
                Database
                <Dropdown
                  ariaLabel="Database"
                  value={provider()}
                  onChange={(value) => {
                    setProvider(value);
                    setConnection('');
                  }}
                  options={[
                    { value: 'mongodb', label: 'MongoDB' },
                    { value: 'postgres', label: 'PostgreSQL' },
                  ]}
                />
              </label>
              <label>
                Connection
                <Dropdown
                  ariaLabel="Connection"
                  value={mode()}
                  onChange={setMode}
                  options={[
                    {
                      value: 'bundled',
                      label: 'Use Bundled Database',
                      disabled: !status()?.bundled?.[provider()],
                    },
                    { value: 'custom', label: 'Use My Own Connection' },
                  ]}
                />
              </label>
              <Show when={mode() === 'custom'}>
                <label>
                  Connection String
                  <input
                    type="password"
                    name="connectionString"
                    required
                    maxlength="4096"
                    autocomplete="off"
                    placeholder={
                      provider() === 'mongodb'
                        ? 'mongodb://user:password@host:27017/agentzuno'
                        : 'postgresql://user:password@host:5432/agentzuno'
                    }
                    value={connection()}
                    onInput={(event) => setConnection(event.currentTarget.value)}
                  />
                </label>
              </Show>
              <button class="workspace-button" disabled={busy()}>
                <Icon name="link" />

                {busy() ? 'Testing Connection…' : 'Connect and Continue'}
              </button>
            </ValidatedForm>
          </Show>
        </Show>
      </section>
    </main>
  );
}
