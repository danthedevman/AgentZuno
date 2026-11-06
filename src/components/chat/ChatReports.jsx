import { useNavigate } from '@solidjs/router';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import RecordTable from '../records/RecordTable.jsx';
import A from '../WorkspaceLink.jsx';
export default function ChatReports(props) {
  const navigate = useNavigate(),
    path = useWorkspacePath();
  const href = (row) => `/workspace/reports/chats/${row.id}?days=${props.days}`;
  return (
    <RecordTable
      label="Workspace Chats"
      cardColumns={['Chat', 'User', 'Channel', 'Status', 'Updated']}
      source="/api/helpdesk/report-chats"
      sourceParams={{ days: props.days }}
      refreshKey={props.refreshKey}
      defaultSort={{ key: 'Updated', direction: 'desc' }}
      onRowClick={(row) => navigate(path(href(row)))}
      columns={[
        { label: 'Chat', render: (row) => <A href={href(row)}>{row.title}</A> },
        { label: 'User', sortable: false, render: (row) => row.user },
        { label: 'Channel', sortable: false, render: (row) => row.channel },
        { label: 'Assistant', sortable: false, render: (row) => row.assistant },
        { label: 'Status', render: (row) => row.status },
        { label: 'Started', render: (row) => new Date(row.createdAt).toLocaleString() },
        { label: 'Updated', render: (row) => new Date(row.updatedAt).toLocaleString() },
      ]}
    />
  );
}
