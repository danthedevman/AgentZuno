import { createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../services/api.js';
import RecordTable from './records/RecordTable.jsx';
import Skeleton from './Skeleton.jsx';
import ToastMessage from './ToastMessage.jsx';
import A from './WorkspaceLink.jsx';
import { statusLabel } from '../utils/displayLabels.js';
export default function MyTeamReport(props) {
  const [tab, setTab] = createSignal('requests');
  const [summary] = createResource(
    () => props.refreshKey,
    () => api('/api/helpdesk/my-team?summary=1'),
  );
  return (
    <>
      <Show when={summary.error}>
        <ToastMessage tone="error">{summary.error.message}</ToastMessage>
      </Show>
      <div class="knowledge-metrics">
        <For each={['total', 'active', 'unassigned', 'groups']}>
          {(key) => (
            <article class="knowledge-metric">
              <span>
                {
                  {
                    total: 'Requests',
                    active: 'Active Requests',
                    unassigned: 'Unassigned',
                    groups: 'Assignment Groups',
                  }[key]
                }
              </span>
              <Show when={summary()} fallback={<Skeleton lines={1} />}>
                <strong>{summary()[key]}</strong>
              </Show>
            </article>
          )}
        </For>
      </div>
      <div class="record-detail-tabs" role="tablist" aria-label="Team views">
        <For each={['requests', 'groups']}>
          {(value) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab() === value}
              onClick={() => setTab(value)}
            >
              {value === 'requests' ? 'Work Items' : 'Assignment Groups'}
            </button>
          )}
        </For>
      </div>
      <Show keyed when={tab()}>
        {(kind) => (
          <RecordTable
            label={kind === 'groups' ? 'Assignment Groups' : 'Team Work Items'}
            cardColumns={
              kind === 'groups'
                ? ['Group', 'Members', 'Active', 'Updated']
                : ['Request', 'Status', 'Assignment Group', 'Updated']
            }
            source="/api/helpdesk/my-team"
            sourceParams={{ kind }}
            refreshKey={props.refreshKey}
            emptyText="No team work to display"
            columns={
              kind === 'groups'
                ? [
                    {
                      label: 'Group',
                      render: (row) => <A href={`/workspace/users/groups/${row.id}`}>{row.name}</A>,
                    },
                    { label: 'Members', render: (row) => row.members },
                    { label: 'Active', render: (row) => row.active },
                    { label: 'Total', render: (row) => row.total },
                    {
                      label: 'Updated',
                      render: (row) =>
                        row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—',
                    },
                  ]
                : [
                    {
                      label: 'Request',
                      render: (row) => (
                        <A
                          href={
                            row.chatId
                              ? `/workspace/chat/${row.chatId}?request=${row.id}`
                              : `/workspace/requests/${row.id}`
                          }
                        >
                          {row.number} · {row.title}
                        </A>
                      ),
                    },
                    { label: 'Status', render: (row) => statusLabel(row.status) },
                    { key: 'Queue', label: 'Assignment Group', render: (row) => row.queueName },
                    { label: 'Updated', render: (row) => new Date(row.updatedAt).toLocaleString() },
                  ]
            }
          />
        )}
      </Show>
    </>
  );
}
