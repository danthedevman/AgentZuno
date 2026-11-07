import Icon from '../../components/Icon.jsx';
import { A, useNavigate } from '@solidjs/router';
import { Show, createResource, createSignal } from 'solid-js';
import { useSession } from '../../context/SessionContext.jsx';
import { api } from '../../services/api.js';
import ToastMessage from '../../components/ToastMessage.jsx';
export default function SlackLinkPage() {
  const { session } = useSession(),
    navigate = useNavigate();
  let token = window.location.hash.slice(1);
  try {
    if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem('agentzuno-slack-link', token);
    else token = sessionStorage.getItem('agentzuno-slack-link') || '';
    window.history.replaceState(null, '', window.location.pathname);
  } catch {}
  const [busy, setBusy] = createSignal(false),
    [error, setError] = createSignal('');
  const [link] = createResource(
    () => (session()?.user && /^[a-f0-9]{64}$/.test(token) ? token : false),
    (token) =>
      api('/api/helpdesk/channels/slack/link/inspect', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
  );
  return (
    <main class="login-page">
      <A class="login-brand" href="/">
        AgentZuno
      </A>
      <section class="login-panel">
        <h1>Link your Slack account</h1>
        <Show
          when={/^[a-f0-9]{64}$/.test(token)}
          fallback={<p>Message Zuno in Slack for a new linking request.</p>}
        >
          <Show
            when={session()?.user}
            fallback={
              <>
                <p>Sign in with your existing AgentZuno workspace account to review this link.</p>
                <A class="workspace-button" href="/login?next=slack-link">
                  <Icon name="login" />
                  Sign In
                </A>
              </>
            }
          >
            <Show
              when={link()}
              fallback={<p>{link.error?.message || 'Checking your linking request…'}</p>}
            >
              <p>
                Link Slack member {link()?.slackUserId} in{' '}
                {link()?.teamName || 'your Slack workspace'} to {session()?.user?.email}?
              </p>
              <p>Your role and permissions stay the same.</p>
              <button
                class="workspace-button"
                disabled={busy()}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await api('/api/helpdesk/channels/slack/link/complete', {
                      method: 'POST',
                      body: JSON.stringify({ token, confirmed: true }),
                    });
                    sessionStorage.removeItem('agentzuno-slack-link');
                    navigate(`/workspace/${result.workspaceId}/chat`, { replace: true });
                  } catch (error) {
                    setError(error.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="link" />
                Confirm Account Link
              </button>
            </Show>
          </Show>
        </Show>
        <Show when={error()}>
          <ToastMessage tone="error">{error()}</ToastMessage>
        </Show>
      </section>
    </main>
  );
}
