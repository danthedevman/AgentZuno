import { Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import MyWorkPage from './reports/MyWorkPage.jsx';
import RequestsPage from './requests/RequestsPage.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';

export default function DashboardPage() {
  const { access } = useWorkspace();
  const [query, setQuery] = useSearchParams();
  const canWork = () => !access.error && ['admin', 'agent'].includes(access()?.role);
  const work = () => canWork() && query.view !== 'requests';
  const navigation = () => (
    <Show when={canWork()}>
      <nav class="record-detail-tabs dashboard-view-tabs" aria-label="Dashboard views">
        <button type="button" aria-pressed={!work()} onClick={() => setQuery({ view: 'requests' })}>
          My Requests
        </button>
        <button type="button" aria-pressed={work()} onClick={() => setQuery({ view: 'work' })}>
          My Work
        </button>
      </nav>
    </Show>
  );
  return (
    <Show
      when={!access.error}
      fallback={<ToastMessage tone="error">{access.error?.message}</ToastMessage>}
    >
      <Show when={!access.loading && access()} fallback={<Skeleton label="Loading dashboard" />}>
        <Show when={work()} fallback={<RequestsPage title="Dashboard" navigation={navigation()} />}>
          <MyWorkPage title="Dashboard" navigation={navigation()} />
        </Show>
      </Show>
    </Show>
  );
}
