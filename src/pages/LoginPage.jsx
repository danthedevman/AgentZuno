import ToastMessage from '../components/ToastMessage.jsx';
import ValidatedForm from '../components/ValidatedForm.jsx';
import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { createSignal, createResource, createEffect, Show } from 'solid-js';
import { api } from '../services/api.js';
import { useSession } from '../context/SessionContext.jsx';

export default function LoginPage(props) {
  const { session, signIn, register } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [portal] = createResource(() => api('/api/portal'));
  const [enterprise] = createResource(
    () =>
      !portal.loading && !portal.error && !portal()?.workspaceId
        ? params.workspace || false
        : false,
    (workspace) => api(`/api/auth/oidc/provider?workspace=${encodeURIComponent(workspace)}`),
  );
  const targetWorkspace = () =>
    (!portal.error && portal()?.workspaceId) ||
    (/^[a-f0-9]{24}$/.test(params.workspace || '')
      ? params.workspace
      : session()?.user?.impersonation?.workspaceId || session()?.user?.workspaceId);
  const isRegister = () => props.isRegister === true;
  createEffect(() => {
    if (!session.loading && session()?.user && !props.isRegister && !isSubmitting()) {
      if (params.next === 'invite') {
        const token = sessionStorage.getItem('agentzuno-invitation');
        if (token && /^[a-f0-9]{64}$/.test(token)) {
          navigate(`/invite#${token}`, { replace: true });
          return;
        }
      }
      navigate(
        `/workspace/${targetWorkspace()}${params.next === 'chat' ? `/chat${/^[a-f0-9]{24}$/.test(params.chat || '') ? `/${params.chat}` : ''}${/^[a-f0-9-]{36}$/.test(params.draft || '') ? `?draft=${params.draft}` : ''}` : ''}`,
        { replace: true },
      );
    }
  });
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  async function submit(event) {
    event.preventDefault();
    if (portal.loading) return;
    setIsSubmitting(true);
    setError('');
    try {
      await (isRegister() ? register(email(), password()) : signIn(email(), password()));
      if (params.next === 'invite') {
        const invite = sessionStorage.getItem('agentzuno-invitation');
        if (invite && /^[a-f0-9]{64}$/.test(invite)) {
          if (isRegister()) {
            const next = `/workspace/${targetWorkspace()}${params.next === 'chat' ? `/chat${/^[a-f0-9]{24}$/.test(params.chat || '') ? `/${params.chat}` : ''}${/^[a-f0-9-]{36}$/.test(params.draft || '') ? `?draft=${params.draft}` : ''}` : ''}`;
            sessionStorage.setItem(`agentzuno-setup-next:${targetWorkspace()}`, next);
            navigate(`/workspace/${targetWorkspace()}/setup`, { replace: true });
            return;
          }
          navigate(`/invite#${invite}`, { replace: true });
          return;
        }
      }
      navigate(
        `/workspace/${targetWorkspace()}${params.next === 'chat' ? `/chat${/^[a-f0-9]{24}$/.test(params.chat || '') ? `/${params.chat}` : ''}${/^[a-f0-9-]{36}$/.test(params.draft || '') ? `?draft=${params.draft}` : ''}` : params.next === 'create' ? '?create=1' : ''}`,
        { replace: true },
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }
  function switchPath() {
    const query = new URLSearchParams();
    for (const key of ['next', 'chat', 'draft', 'workspace'])
      if (params[key]) query.set(key, params[key]);
    return `${isRegister() ? '/login' : '/register'}${query.size ? '?' + query : ''}`;
  }
  return (
    <main class="login-page">
      <A class="login-brand" href="/">
        <img src="/agentzuno-wordmark.svg" alt="AgentZuno" width="240" height="60" />
      </A>
      <section class="login-panel">
        <h1>{isRegister() ? 'Register' : 'Welcome back.'}</h1>

        <Show when={session()?.user}>
          <p>
            You’re signed in as {session()?.user?.name}.{' '}
            <A href={`/workspace/${session()?.user?.workspaceId}`}>Open your workspace</A>
          </p>
        </Show>
        <Show when={enterprise()}>
          <p>
            <a
              class="workspace-button"
              href={`/api/auth/oidc/start?workspace=${enterprise().workspaceId}`}
            >
              Continue with enterprise SSO
            </a>
          </p>
        </Show>
        <ValidatedForm onSubmit={submit}>
          <label>
            Email
            <input
              name="email"
              type="email"
              autocomplete="username"
              required
              maxlength="254"
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autocomplete={isRegister() ? 'new-password' : 'current-password'}
              required
              minlength={isRegister() ? 12 : undefined}
              maxlength="200"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </label>

          <Show when={error()}>
            <ToastMessage tone="error">{error()}</ToastMessage>
          </Show>
          <button class="workspace-button" type="submit" disabled={isSubmitting()}>
            {isSubmitting() ? 'Opening workspace…' : isRegister() ? 'Create account' : 'Sign in'}
          </button>
        </ValidatedForm>
        <p>
          {isRegister() ? 'Already have an account?' : 'New to AgentZuno?'}{' '}
          <A class="auth-switch" href={switchPath()}>
            {isRegister() ? 'Sign in' : 'Create an account'}
          </A>
        </p>
      </section>
    </main>
  );
}
