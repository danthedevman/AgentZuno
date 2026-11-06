import { DashboardActionsProvider } from '../../../context/DashboardActionsContext.jsx';
import DashboardToolbar from '../../../components/reports/DashboardToolbar.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';
import ChatReports from '../../../components/chat/ChatReports.jsx';
import MyTeamReport from '../../../components/MyTeamReport.jsx';
import ReferenceLookup from '../../../components/ReferenceLookup.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import { useNavigate } from '@solidjs/router';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import Icon from '../../../components/Icon.jsx';
import { createSignal, Show, createResource, lazy, Suspense, For } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import { displayLabel } from '../../../utils/displayLabels.js';
import Dropdown from '../../../components/Dropdown.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
const KnowledgeReport = lazy(() => import('../knowledge/KnowledgeOverviewPage.jsx'));
const KnowledgeChart = lazy(() => import('../../../components/knowledge/KnowledgeChart.jsx'));
export default function ReportsPage() {
  const { access } = useWorkspace();
  const navigate = useNavigate(),
    path = useWorkspacePath();
  const [query, setQuery] = useSearchParams();
  const [workflowSearch, setWorkflowSearch] = createSignal('');
  const [selectedWorkflow, setSelectedWorkflow] = createSignal(null);
  const canRead = () => !access.error && ['admin', 'read-only', 'agent'].includes(access()?.role);
  const report = () =>
    (access()?.role === 'agent'
      ? ['team']
      : [
          'team',
          'knowledge',
          'workflows',
          'agents',
          'audit',
          ...(access()?.role === 'admin' ? ['chats'] : []),
        ]
    ).includes(query.report)
      ? query.report
      : access()?.role === 'agent'
        ? 'team'
        : access()?.role === 'read-only'
          ? 'audit'
          : 'knowledge';
  const [auditWorkflows] = createResource(
    () => (report() === 'audit' && canRead() ? workflowSearch() : false),
    (q) => api(`/api/helpdesk/audit/workflows?q=${encodeURIComponent(q)}`),
  );
  const days = () => (['7', '30', '90'].includes(query.days) ? query.days : '30');
  const [data, { refetch }] = createResource(
    () =>
      canRead() &&
      !['team', 'knowledge', 'audit', 'chats'].includes(report()) &&
      `${report()}:${days()}`,
    () => api(`/api/helpdesk/reports/${report()}?days=${days()}`),
  );
  const [refreshKey, setRefreshKey] = createSignal(0);
  const current = () => (data.error ? null : data());
  const reportActions = () =>
    access()?.role === 'read-only'
      ? []
      : report() === 'workflows'
        ? [{ label: 'View Workflows', href: '/workspace/workflows' }]
        : report() === 'knowledge'
          ? [{ label: 'Open Knowledge', href: '/workspace/knowledge' }]
          : report() === 'audit' && access()?.role === 'admin'
            ? [{ label: 'Workspace Settings', href: '/workspace/settings' }]
            : [{ label: 'My Work', href: '/workspace/my-work' }];
  const selector = () => (
    <Dropdown
      ariaLabel="Report"
      value={report()}
      onChange={(value) => setQuery({ report: value })}
      options={(access()?.role === 'agent'
        ? []
        : [
            { value: 'knowledge', label: 'Knowledge Health' },
            { value: 'workflows', label: 'Workflow Execution' },
            { value: 'agents', label: 'Agent Activity' },
            ...(access()?.role === 'admin' ? [{ value: 'chats', label: 'Chat Activity' }] : []),
            { value: 'audit', label: 'Audit' },
          ]
      ).concat([{ value: 'team', label: 'My Team' }])}
    />
  );
  return (
    <DashboardActionsProvider>
      <section class="reading-page reports-page">
        <Show when={!canRead()}>
          <RecordHeader title="Reports" />
        </Show>
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
                <DashboardToolbar
                  title="Reports"
                  loading={data.loading}
                  actions={reportActions()}
                  onRefresh={() => {
                    if (['audit', 'team', 'chats'].includes(report()))
                      setRefreshKey((value) => value + 1);
                    else refetch();
                  }}
                >
                  {selector()}
                  <Show when={report() !== 'team'}>
                    <Dropdown
                      ariaLabel="Reporting period"
                      value={days()}
                      onChange={(value) => setQuery({ days: value })}
                      options={['7', '30', '90'].map((value) => ({
                        value,
                        label: `Last ${value} days`,
                      }))}
                    />
                  </Show>
                </DashboardToolbar>
                <Show when={data.error}>
                  <ToastMessage tone="error">{data.error.message}</ToastMessage>
                </Show>
                <Show when={report() === 'team'}>
                  <MyTeamReport refreshKey={refreshKey()} />
                </Show>
                <Show when={report() === 'chats'}>
                  <ChatReports days={days()} refreshKey={refreshKey()} />
                </Show>
                <Show when={!['audit', 'team', 'chats'].includes(report())}>
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
                  <div class="report-records">
                    <Show keyed when={report()}>
                      {(kind) => (
                        <RecordTable
                          label={kind === 'workflows' ? 'Workflow Execution' : 'Agent Activity'}
                          cardColumns={
                            kind === 'workflows'
                              ? ['Workflow', 'Runs', 'Completed', 'Failed']
                              : [
                                  'Agent',
                                  'Conversations',
                                  'Completed Responses',
                                  'Failed Responses',
                                ]
                          }
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
                          ).map(({ key, ...column }) => ({
                            ...column,
                            render: (item) => item[key],
                          }))}
                        />
                      )}
                    </Show>
                  </div>
                </Show>
                <Show when={report() === 'audit'}>
                  <RecordTable
                    label="Audit Logs"
                    toolbarFilters={
                      <div class="audit-report-filters">
                        <ReferenceLookup
                          label="Workflow"
                          placeholder="All Workflows"
                          value={query.workflowId || ''}
                          options={[
                            ...(auditWorkflows.error ? [] : auditWorkflows() || []),
                            ...(selectedWorkflow() &&
                            !(auditWorkflows() || []).some(
                              (item) => item.value === selectedWorkflow().value,
                            )
                              ? [selectedWorkflow()]
                              : []),
                          ]}
                          onSearch={setWorkflowSearch}
                          onChange={(value) => {
                            setSelectedWorkflow(
                              (auditWorkflows() || []).find((item) => item.value === value),
                            );
                            setQuery({ workflowId: value || undefined });
                          }}
                        />
                        <Dropdown
                          ariaLabel="Event trigger"
                          value={query.triggerType || ''}
                          options={[
                            { value: '', label: 'All Triggers' },
                            ...[
                              'admin-chat',
                              'support-chat',
                              'request-submission',
                              'workflow-step',
                              'approval-decision',
                              'workflow-configuration',
                              'record-update',
                              'api-request',
                            ].map((value) => ({ value, label: displayLabel(value) })),
                          ]}
                          onChange={(value) => setQuery({ triggerType: value || undefined })}
                        />
                      </div>
                    }
                    cardColumns={['Event', 'Actor', 'Outcome', 'Time']}
                    onRowClick={(item) => navigate(path(`/workspace/reports/audit/${item.id}`))}
                    refreshKey={refreshKey()}
                    source="/api/helpdesk/audit"
                    sourceParams={{
                      days: days(),
                      ...(query.workflowId ? { workflowId: query.workflowId } : {}),
                      ...(query.triggerType ? { triggerType: query.triggerType } : {}),
                    }}
                    defaultSort={{ key: 'Time', direction: 'desc' }}
                    emptyText="No audit logs in this period."
                    columns={[
                      {
                        label: 'Event',
                        sortKey: 'Action',
                        render: (item) => (
                          <span class="report-event">
                            <strong>{item.action || item.method}</strong>
                            <small class="record-secondary">
                              {item.workflowName || item.target}
                            </small>
                          </span>
                        ),
                      },
                      {
                        label: 'Actor',
                        render: (item) => (
                          <span>
                            {item.actorName || displayLabel(item.actorType || 'Account')}
                            <small class="record-secondary">
                              {displayLabel(item.role || 'System')}
                            </small>
                          </span>
                        ),
                      },
                      { label: 'Outcome', render: (item) => displayLabel(item.outcome) },
                      {
                        label: 'Time',
                        render: (item) =>
                          new Date(item.startedAt || item.completedAt).toLocaleString(),
                      },
                    ]}
                  />
                </Show>
              </>
            }
          >
            <Suspense fallback={<Skeleton label="Loading knowledge report" lines={5} />}>
              <KnowledgeReport title="Reports" actions={reportActions()} selector={selector()} />
            </Suspense>
          </Show>
        </Show>
      </section>
    </DashboardActionsProvider>
  );
}
