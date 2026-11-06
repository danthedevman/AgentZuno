import RecordTable from '../records/RecordTable.jsx';
import A from '../WorkspaceLink.jsx';
import { displayLabel } from '../../services/displayLabels.js';
export default function QueueList(props) {
  return (
    <RecordTable
      onEmptyChange={props.onEmptyChange}
      label="Queues"
      emptyAction={{ label: 'Add Queue', href: '/workspace/users/queues/new' }}
      source="/api/helpdesk/queues"
      query={props.query}
      refreshKey={props.refreshKey}
      defaultSort={{ key: 'Queue', direction: 'asc' }}
      columns={[
        {
          label: 'Queue',
          render: (item) => (
            <A class="article-table-title" href={`/workspace/users/queues/${item.id}`}>
              <strong>{displayLabel(item.name)}</strong>
            </A>
          ),
        },
        { label: 'Description', render: (item) => item.description || '—' },
        { label: 'Members', render: (item) => item.agents.join(', ') || '—' },
        {
          label: 'Updated',
          defaultDirection: 'desc',
          render: (item) => (item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—'),
        },
      ]}
      emptyText="No queues yet."
    />
  );
}
