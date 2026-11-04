import { Show, For, createResource } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import CodeBlock from '../../components/CodeBlock.jsx';
import { displayLabel } from '../../services/displayLabels.js';

export default function AuditRecordPage() {
  const params = useParams(),
    navigate = useNavigate(),
    path = useWorkspacePath();
  const { access } = useWorkspace();
  const canRead = () => !access.error && ['admin', 'read-only'].includes(access()?.role);
  const [record] = createResource(
    () => canRead() && params.id,
    (id) => api(`/api/helpdesk/audit/${id}`),
  );
  const current = () => (record.error ? null : record());
  const date = (value) => (value ? new Date(value).toLocaleString() : '—');
  const details = () => [
    ['Actor', current()?.actorId || current()?.actorType || 'System'],
    ['Actor Type', displayLabel(current()?.actorType || 'System')],
    ['Effective Role', displayLabel(current()?.role || 'System')],
    ['Actual Role', displayLabel(current()?.actualRole || current()?.role || 'System')],
    ['Impersonating', current()?.isImpersonating ? 'Yes' : 'No'],
    ['Operation', current()?.action || current()?.method],
    ['Method', current()?.method],
    ['Target', current()?.target],
    ['Resource ID', current()?.resourceId || '—'],
    ['Outcome', displayLabel(current()?.outcome || '')],
    ['HTTP Status', current()?.statusCode ?? '—'],
    ['Started', date(current()?.startedAt)],
    ['Completed', date(current()?.completedAt)],
    ['Version Before', current()?.versionBefore ?? '—'],
    ['Version After', current()?.versionAfter ?? '—'],
    ['Matched', current()?.matchedCount ?? '—'],
    ['Modified', current()?.modifiedCount ?? '—'],
    ['Inserted', current()?.insertedCount ?? '—'],
    ['Deleted', current()?.deletedCount ?? '—'],
    ['Exported Records', current()?.recordCount ?? '—'],
    ['Correlation ID', current()?.requestAuditId || current()?.id],
  ];
  return (
    <section class="reading-page audit-record-page">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/workspace/reports' },
          { label: 'Audit', href: '/workspace/reports?report=audit' },
          { label: 'Audit Record' },
        ]}
      />
      <PageHeading title="Audit Record" />
      <Show when={record.error}>
        <ToastMessage tone="error">{record.error.message}</ToastMessage>
      </Show>
      <Show when={record.loading || access.loading}>
        <Skeleton label="Loading audit details" lines={8} />
      </Show>
      <Show when={!access.loading && !canRead()}>
        <ToastMessage tone="error">Audit access is required.</ToastMessage>
      </Show>
      <Show when={current()}>
        <dl class="audit-record-details">
          <For each={details()}>
            {([label, value]) => (
              <div>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            )}
          </For>
        </dl>
        <h2>Changed Fields</h2>
        <p>{current()?.changedFields?.join(', ') || 'No field changes recorded for this event.'}</p>
        <p>
          Audit history records field names and versions. Sensitive values and private content are
          excluded.
        </p>
        <h2>Related Activity</h2>
        <RecordTable
          label="Related Audit Events"
          source={`/api/helpdesk/audit/${params.id}/events`}
          defaultSort={{ key: 'Time', direction: 'asc' }}
          onRowClick={(item) => navigate(path(`/workspace/reports/audit/${item.id}`))}
          columns={[
            {
              label: 'Time',
              key: 'startedAt',
              sortKey: 'Time',
              render: (item) => date(item.startedAt),
            },
            { label: 'Action', key: 'action', sortKey: 'Action' },
            { label: 'Outcome', key: 'outcome', sortKey: 'Outcome' },
            {
              label: 'Fields',
              exportValue: (item) => item.changedFields?.join(', '),
              render: (item) => item.changedFields?.join(', ') || '—',
            },
            { label: 'Version', key: 'versionAfter', sortKey: 'Version' },
          ]}
          emptyText="No related activity."
        />
        <details>
          <summary>Record JSON</summary>
          <CodeBlock language="json" code={JSON.stringify(current(), null, 2)} />
        </details>
      </Show>
    </section>
  );
}
