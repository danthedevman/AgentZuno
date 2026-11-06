import { A, useNavigate } from '@solidjs/router';
import { createEffect, createResource, Show } from 'solid-js';
import { useSession } from '../../context/SessionContext.jsx';
import { api } from '../../services/api.js';
import { publicAsset } from '../../services/public/publicAsset.js';
import Skeleton from '../../components/Skeleton.jsx';

export default function InstallationPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const [installation, { refetch }] = createResource(() => api('/api/installation/database'));
  createEffect(() => {
    if (installation.error || !installation()) return;
    if (installation().configured === false) {
      navigate('/setup/database', { replace: true });
    } else if (installation().configured === true && !session.loading) {
      const user = session()?.user;
      navigate(
        user ? `/workspace/${user.impersonation?.workspaceId || user.workspaceId}` : '/login',
        { replace: true },
      );
    }
  });
  return (
    <main class="login-page">
      <img
        class="login-brand"
        src={publicAsset('/agentzuno-wordmark.svg')}
        width="240"
        height="60"
        alt="AgentZuno"
      />
      <section class="login-panel">
        <Show when={installation.error} fallback={<Skeleton label="Opening AgentZuno" lines={2} />}>
          <h1>Unable to connect</h1>
          <p>Check that the AgentZuno backend is running, then try again.</p>
          <button class="workspace-button" onClick={() => refetch()}>
            Try Again
          </button>
          <A href="/docs#database-setup">Setup guide</A>
        </Show>
      </section>
    </main>
  );
}
