import DashboardToolbar from '../../../components/reports/DashboardToolbar.jsx';
import DataExportButtons from '../../../components/DataExportButtons.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import { displayLabel } from '../../../utils/displayLabels.js';
import Icon from '../../../components/Icon.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import { For, Show, Suspense, createResource, lazy } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useSession } from '../../../context/SessionContext.jsx';
import { api } from '../../../services/api.js';
import Dropdown from '../../../components/Dropdown.jsx';
const KnowledgeChart = lazy(() => import('../../../components/knowledge/KnowledgeChart.jsx'));

export default function KnowledgeOverviewPage(props) {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const days = () => (['7', '30', '90'].includes(params.days) ? params.days : '30');
  const [report, { refetch }] = createResource(
    () => `${session()?.user?.id || 'guest'}:${days()}`,
    () => api(`/api/knowledge/overview?days=${days()}`),
  );
  const data = () => (report.error ? null : report());
  const cards = () =>
    !data()
      ? []
      : [
          ['Knowledge bases', data().summary.knowledgeBases, 'Current inventory'],
          [
            'Articles',
            data().summary.articles,
            `${data().summary.importedArticles} imported snapshots`,
          ],
          ['Article views', data().summary.views, `Last ${days()} days`],
          ['Knowledge queries', data().summary.agentQueries, `Last ${days()} days`],
          [
            'Queries with results',
            `${data().summary.retrievalRate}%`,
            `${data().summary.emptyQueries} returned no results`,
          ],
          ['Topics', data().summary.topics, 'Knowledge organization'],
          ['Articles to review', data().summary.staleArticles, 'Not updated in 90 days'],
          ['Empty bases', data().summary.emptyBases, 'No stored articles'],
        ];
  return (
    <section class="knowledge-overview" aria-label="Knowledge overview">
      <DashboardToolbar
        refreshLabel="Refresh knowledge statistics"
        loading={report.loading}
        actions={props.actions}
        onRefresh={() => refetch()}
      >
        {props.selector}
        <Dropdown
          ariaLabel="Reporting period"
          value={days()}
          onChange={(value) => setParams({ days: value })}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
          ]}
        />
      </DashboardToolbar>
      <Show when={report.error}>
        <ToastMessage tone="error">Could not load knowledge statistics.</ToastMessage>
      </Show>
      <Show when={report.loading && !data()}>
        <div class="knowledge-metrics" aria-busy="true">
          <For each={Array.from({ length: 8 })}>
            {() => <div class="knowledge-metric metric-skeleton" />}
          </For>
        </div>
      </Show>
      <Show when={data()}>
        <Show when={data()?.isExample}>
          <p class="analytics-note">
            Example inventory. Views and agent activity are recorded in your signed-in workspace.
          </p>
        </Show>
        <div class="knowledge-metrics">
          <For each={cards()}>
            {([label, value, description]) => (
              <article class="knowledge-metric">
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{description}</small>
              </article>
            )}
          </For>
        </div>
        <div class="knowledge-chart-grid">
          <Suspense fallback={<Skeleton label="Loading charts" lines={6} />}>
            <KnowledgeChart
              title="Knowledge activity"
              kind="line"
              data={data()?.daily}
              description="Daily article views and permitted knowledge queries, in UTC."
            />
            <KnowledgeChart
              title="Article inventory"
              kind="donut"
              data={data()?.articleStates}
              description="Saved and published content, plus imported snapshots."
              emptyText="Create or import an article to see inventory."
            />
            <KnowledgeChart
              title="Most viewed articles"
              kind="bar"
              data={data()?.mostViewed}
              description="Article opens in this workspace during the selected period."
            />
            <KnowledgeChart
              title="Most retrieved articles"
              kind="bar"
              data={data()?.mostReferenced}
              description="Articles returned by permitted searches. Downstream answer citations are not tracked."
            />

            <KnowledgeChart
              title="Knowledge-base coverage"
              kind="bar"
              data={data()?.coverage}
              description="Stored article counts per base, including imported snapshots."
              emptyText="Your bases do not contain any stored articles yet."
            />
          </Suspense>
        </div>
        <Show when={data()?.connections.length}>
          <section class="knowledge-health-table">
            <h2>Source health</h2>
            <DataExportButtons
              label="Source Health"
              rows={data()?.connections || []}
              columns={[
                { label: 'Source', key: 'label' },
                { label: 'Status', key: 'status' },
                { label: 'Import', key: 'syncStatus' },
                { label: 'Documents', key: 'documentCount' },
                { label: 'Last Complete Sync', key: 'lastAt' },
              ]}
            />
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Import</th>
                    <th>Documents</th>
                    <th>Last complete sync</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={data()?.connections}>
                    {(source) => (
                      <tr>
                        <th scope="row">{source.label}</th>
                        <td>{displayLabel(source.status)}</td>
                        <td>{source.syncStatus}</td>
                        <td>{source.documentCount}</td>
                        <td>
                          {source.lastAt ? new Date(source.lastAt).toLocaleString() : 'Never'}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </section>
        </Show>
        <p class="analytics-note">
          Usage is recorded from this version onward. Imported inventory is an operational snapshot;
          source permissions are checked before opening or returning content. Queries that return no
          results may reflect missing knowledge or access restrictions.
        </p>
        <p class="analytics-note">
          Updated {new Date(data()?.asOf).toLocaleString()}
          {data()?.summary.agentQueries
            ? ` · Average query time ${data().summary.averageDurationMs} ms`
            : ''}
        </p>
      </Show>
    </section>
  );
}
