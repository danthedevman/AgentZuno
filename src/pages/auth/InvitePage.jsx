import Icon from '../../components/Icon.jsx';
import { Show, createSignal } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { useSession } from '../../context/SessionContext.jsx';
import { api } from '../../services/api.js';
import ToastMessage from '../../components/ToastMessage.jsx';
export default function InvitePage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const token = window.location.hash.slice(1);
  try {
    if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem('agentzuno-invitation', token);
  } catch {}
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  return (
    <main class="login-page">
      <A class="login-brand" href="/">
        AgentZuno
      </A>
      <section class="login-panel">
        <h1>Workspace Invitation</h1>
        <Show
          when={/^[a-f0-9]{64}$/.test(token)}
          fallback={<p>This invitation link is invalid.</p>}
        >
          <Show
            when={!session.loading && session()?.user}
            fallback={
              <>
                <p>Sign in or register with the email address that received this invitation.</p>
                <A class="workspace-button" href="/login?next=invite">
                  <Icon name="login" />
                  Sign In
                </A>
                <A href="/register?next=invite">Register</A>
              </>
            }
          >
            <p>Accept as {session()?.user?.email}</p>
            <button
              class="workspace-button"
              disabled={busy()}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const result = await api('/api/helpdesk/invitations/accept', {
                    method: 'POST',
                    body: JSON.stringify({ token }),
                  });
                  navigate(`/workspace/${result.workspaceId}/chat`, { replace: true });
                } catch (error) {
                  setError(error.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="send" />

              {busy() ? 'Accepting…' : 'Accept Invitation'}
            </button>
          </Show>
        </Show>
        <Show when={error()}>
          <ToastMessage tone="error">{error()}</ToastMessage>
        </Show>
      </section>
    </main>
  );
}
