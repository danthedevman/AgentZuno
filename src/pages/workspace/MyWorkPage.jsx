import { createResource, createSignal, Show, For, lazy, Suspense } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import { statusLabel, displayLabel } from '../../services/displayLabels.js';
import A from '../../components/WorkspaceLink.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ContentTransition from '../../components/ContentTransition.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import Icon from '../../components/Icon.jsx';
const KnowledgeChart = lazy(() => import('../../components/KnowledgeChart.jsx'));

export default function MyWorkPage() {
  const { access } = useWorkspace();
  const allowed = () => !access.error && ['admin', 'agent'].includes(access()?.role);
  const [query, setQuery] = createSignal('');
  const [revision, setRevision] = createSignal(0);
  const [isEmpty, setIsEmpty] = createSignal(false);
  const [summary, { refetch }] = createResource(allowed, () =>
    api('/api/helpdesk/my-work?summary=1'),
  );
  const data = () => (summary.error ? null : summary());
  const count = (status) => data()?.statuses.find((item) => item.name === status)?.value || 0;
  const metrics = () => [
    { label: 'Assigned to Me', value: data()?.total || 0 },
    { label: 'Active Requests', value: (data()?.total || 0) - count('resolved') },
    { label: 'Awaiting Response', value: count('waiting-for-employee') },
    { label: 'Resolved', value: count('resolved') },
  ];
  return (
    <section class="reading-page my-work-page">
      <div class="connections-heading">
        <PageHeading title="My Work" />
        <button
          class="workspace-button secondary small"
          type="button"
          aria-label="Refresh My Work"
          disabled={!allowed() || summary.loading}
          onClick={() => {
            refetch();
            setRevision((value) => value + 1);
          }}
        >
          <Icon name="refresh" />
        </button>
      </div>
      <Show when={access.loading || !access()}>
        <Skeleton label="Loading access" lines={3} />
      </Show>
      <Show when={!access.loading && access() && !allowed()}>
        <ToastMessage tone="error">My Work is available to Admins and Agents.</ToastMessage>
      </Show>
      <Show when={allowed()}>
        <Show when={summary.error}>
          <ToastMessage tone="error">{summary.error.message}</ToastMessage>
        </Show>
        <div class="my-work-metrics">
          <For each={metrics()}>
            {(item) => (
              <section class="my-work-metric">
                <span>{item.label}</span>
                <Show
                  when={data()}
                  fallback={
                    <Show
                      when={summary.error}
                      fallback={<Skeleton label={`Loading ${item.label}`} lines={1} />}
                    >
                      <strong>—</strong>
                    </Show>
                  }
                >
                  <strong>{item.value}</strong>
                </Show>
              </section>
            )}
          </For>
        </div>
        <h2 class="my-work-section-title">Assigned Requests</h2>
        <Show when={!isEmpty()}>
          <label class="workspace-search">
            <Icon name="search" />
            <input
              type="search"
              maxlength="200"
              aria-label="Search assigned requests"
              placeholder="Search assigned requests…"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </Show>
        <RecordTable
          source={allowed() ? '/api/helpdesk/my-work' : undefined}
          query={query()}
          refreshKey={revision()}
          label="Assigned Requests"
          onEmptyChange={setIsEmpty}
          emptyText="No requests assigned to you"
          emptyAction={{ label: 'Open Inbox', href: '/workspace/inbox' }}
          defaultSort={{ key: 'Updated', direction: 'desc' }}
          columns={[
            {
              label: 'Request',
              render: (item) => (
                <A
                  class="article-table-title"
                  href={
                    item.chatId
                      ? `/workspace/chat/${item.chatId}?request=${item.id}`
                      : `/workspace/requests/${item.id}`
                  }
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.number}</small>
                  </span>
                </A>
              ),
            },
            {
              label: 'Status',
              render: (item) => (
                <span
                  class="activity-status"
                  data-tone={item.status === 'resolved' ? 'positive' : 'informational'}
                >
                  <span class="activity-status-dot" />
                  {statusLabel(item.status)}
                </span>
              ),
            },
            {
              key: 'Queue',
              label: 'Assignment Group',
              render: (item) => displayLabel(item.queueName),
            },
            {
              label: 'Updated',
              render: (item) => (
                <time datetime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
              ),
            },
          ]}
        />
        <h2 class="my-work-section-title">My Workload</h2>
        <ContentTransition
          ready={!!data() || !!summary.error}
          fallback={
            <div class="my-work-reports">
              <Skeleton label="Loading status report" lines={5} />
              <Skeleton label="Loading assignment group report" lines={5} />
            </div>
          }
        >
          <Show when={data()}>
            <div class="my-work-reports">
              <Suspense fallback={<Skeleton label="Loading charts" lines={5} />}>
                <KnowledgeChart
                  kind="bar"
                  title="Requests by Status"
                  emptyText="No assigned requests to report"
                  data={data().statuses.map((item) => ({
                    ...item,
                    name: statusLabel(item.name),
                    label: statusLabel(item.name),
                  }))}
                />
                <KnowledgeChart
                  kind="bar"
                  title="Requests by Assignment Group"
                  emptyText="No assigned requests to report"
                  data={data().groups.map((item) => ({
                    ...item,
                    name: displayLabel(item.name),
                    label: displayLabel(item.name),
                  }))}
                />
              </Suspense>
            </div>
          </Show>
        </ContentTransition>
      </Show>
    </section>
  );
}
