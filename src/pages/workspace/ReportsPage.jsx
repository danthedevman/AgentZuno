import Icon from '../../components/Icon.jsx';
import { createSignal, Show, createResource, lazy, Suspense, For } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import { displayLabel } from '../../services/displayLabels.js';
import PageHeading from '../../components/PageHeading.jsx';
import Dropdown from '../../components/Dropdown.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
const KnowledgeReport = lazy(() => import('./KnowledgeOverviewPage.jsx'));
const KnowledgeChart = lazy(() => import('../../components/KnowledgeChart.jsx'));
export default function ReportsPage() {
  const { access } = useWorkspace();
  const [query, setQuery] = useSearchParams();
  const canRead = () => !access.error && ['admin', 'read-only'].includes(access()?.role);
  const report = () =>
    ['knowledge', 'workflows', 'agents', 'audit'].includes(query.report)
      ? query.report
      : access()?.role === 'read-only'
        ? 'audit'
        : 'knowledge';
  const days = () => (['7', '30', '90'].includes(query.days) ? query.days : '30');
  const [data, { refetch }] = createResource(
    () => canRead() && !['knowledge', 'audit'].includes(report()) && `${report()}:${days()}`,
    () => api(`/api/helpdesk/reports/${report()}?days=${days()}`),
  );
  const [refreshKey, setRefreshKey] = createSignal(0);
  const current = () => (data.error ? null : data());
  const selector = () => (
    <Dropdown
      ariaLabel="Report"
      value={report()}
      onChange={(value) => setQuery({ report: value })}
      options={[
        { value: 'knowledge', label: 'Knowledge Health' },
        { value: 'workflows', label: 'Workflow Execution' },
        { value: 'agents', label: 'Agent Activity' },
        { value: 'audit', label: 'Audit' },
      ]}
    />
  );
  return (
    <section class="reading-page reports-page">
      <div class="connections-heading">
        <PageHeading title="Reports" />
      </div>
      <Show
        when={canRead()}
        fallback={
          <Show when={!access.loading && !!access()}>
            <p>Administrator access is required.</p>
          </Show>
        }
      >
        <Show
          when={report() === 'knowledge'}
          fallback={
            <>
              <div class="list-toolbar reports-toolbar">
                {selector()}
                <Dropdown
                  ariaLabel="Reporting period"
                  value={days()}
                  onChange={(value) => setQuery({ days: value })}
                  options={['7', '30', '90'].map((value) => ({
                    value,
                    label: `Last ${value} Days`,
                  }))}
                />
                <button
                  class="knowledge-refresh-button"
                  type="button"
                  aria-label="Refresh report"
                  title="Refresh"
                  disabled={data.loading}
                  onClick={() => {
                    if (report() === 'audit') setRefreshKey((value) => value + 1);
                    else refetch();
                  }}
                >
                  <Icon name="refresh" />
                </button>
              </div>
              <Show when={data.error}>
                <ToastMessage tone="error">{data.error.message}</ToastMessage>
              </Show>
              <Show when={report() !== 'audit'}>
                <div class="knowledge-metrics">
                  <For
                    each={
                      report() === 'workflows'
                        ? [
                            ['Workflow Runs', current()?.total],
                            [
                              'Completed',
                              current()?.statuses?.find((item) => item.label === 'complete')
                                ?.value || 0,
                            ],
                            [
                              'Failed or Uncertain',
                              current()
                                ?.statuses?.filter((item) =>
                                  ['failed', 'delivery-unknown'].includes(item.label),
                                )
                                .reduce((sum, item) => sum + item.value, 0) || 0,
                            ],
                            [
                              'Average Elapsed Time',
                              current()?.averageElapsedSeconds == null
                                ? '—'
                                : `${current().averageElapsedSeconds}s`,
                            ],
                          ]
                        : [
                            ['Completed Responses', current()?.completed],
                            ['Failed Responses', current()?.failed],
                            ['Chat Requests Submitted', current()?.requestsSubmitted],
                          ]
                    }
                  >
                    {([label, value]) => (
                      <article class="knowledge-metric">
                        <span>{label}</span>
                        <Show
                          when={!data.loading || current()}
                          fallback={<Skeleton lines={1} label={`Loading ${label}`} />}
                        >
                          <strong>{value ?? 0}</strong>
                        </Show>
                      </article>
                    )}
                  </For>
                </div>
                <Show when={report() === 'workflows'}>
                  <p class="field-help">
                    Elapsed time includes time waiting for approval and scheduling.
                  </p>
                  <Suspense fallback={<Skeleton label="Loading workflow chart" lines={4} />}>
                    <KnowledgeChart
                      title="Run Status"
                      kind="bar"
                      data={(current()?.statuses || []).map((item) => ({
                        ...item,
                        label: displayLabel(item.label),
                      }))}
                      description="Recorded execution states in the selected period."
                    />
                  </Suspense>
                </Show>
                <Show keyed when={report()}>
                  {(kind) => (
                    <RecordTable
                      label={kind === 'workflows' ? 'Workflow Execution' : 'Agent Activity'}
                      source={`/api/helpdesk/reports/${kind}`}
                      sourceParams={{ days: days() }}
                      rows={[]}
                      emptyText="No activity recorded in this period."
                      defaultSort={
                        kind === 'workflows' ? { key: 'Runs', direction: 'desc' } : undefined
                      }
                      columns={(kind === 'workflows'
                        ? [
                            { label: 'Workflow', key: 'name' },
                            { label: 'Runs', key: 'runs' },
                            { label: 'Completed', key: 'completed' },
                            { label: 'Failed', key: 'failed' },
                            { label: 'Awaiting Approval', key: 'awaitingApproval' },
                          ]
                        : [
                            { label: 'Agent', key: 'name' },
                            { label: 'Conversations', key: 'conversations' },
                            { label: 'Completed Responses', key: 'completed' },
                            { label: 'Failed Responses', key: 'failed' },
                          ]
                      ).map(({ key, ...column }) => ({ ...column, render: (item) => item[key] }))}
                    />
                  )}
                </Show>
              </Show>
              <Show when={report() === 'audit'}>
                <RecordTable
                  label="Audit Logs"
                  refreshKey={refreshKey()}
                  source="/api/helpdesk/audit"
                  sourceParams={{ days: days() }}
                  defaultSort={{ key: 'Time', direction: 'desc' }}
                  emptyText="No audit logs in this period."
                  columns={[
                    {
                      label: 'Time',
                      render: (item) =>
                        new Date(item.startedAt || item.completedAt).toLocaleString(),
                    },
                    {
                      label: 'Actor',
                      render: (item) => item.actorId || item.actorType || 'System',
                    },
                    { label: 'Action', render: (item) => item.action || item.method },
                    {
                      label: 'Target',
                      render: (item) => (
                        <span>
                          {item.target}
                          <Show when={item.resourceId}>
                            <small class="record-secondary">{item.resourceId}</small>
                          </Show>
                          <Show when={item.changedFields?.length}>
                            <small class="record-secondary">{item.changedFields.join(', ')}</small>
                          </Show>
                        </span>
                      ),
                    },
                    { label: 'Outcome', render: (item) => displayLabel(item.outcome) },
                    {
                      label: 'Role',
                      render: (item) => (
                        <span>
                          {displayLabel(item.role || 'System')}
                          <Show when={item.isImpersonating}>
                            <small class="record-secondary">
                              Impersonated by {displayLabel(item.actualRole)}
                            </small>
                          </Show>
                        </span>
                      ),
                    },
                    {
                      label: 'Version',
                      render: (item) => item.versionAfter ?? item.versionBefore ?? '—',
                    },
                  ]}
                />
              </Show>
            </>
          }
        >
          <Suspense fallback={<Skeleton label="Loading knowledge report" lines={5} />}>
            <KnowledgeReport selector={selector()} />
          </Suspense>
        </Show>
      </Show>
    </section>
  );
}
