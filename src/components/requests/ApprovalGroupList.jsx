import RecordTable from '../records/RecordTable.jsx';
import A from '../WorkspaceLink.jsx';
export default function ApprovalGroupList(props) {
  return (
    <RecordTable
      label="Groups"
      source="/api/helpdesk/groups"
      rows={[]}
      query={props.query}
      onEmptyChange={props.onEmptyChange}
      emptyText="No groups yet."
      emptyAction={{ label: 'Add Group', href: '/workspace/users/groups/new' }}
      columns={[
        {
          label: 'Group',
          render: (item) => (
            <A class="article-table-title" href={`/workspace/users/groups/${item.id}`}>
              {item.name}
            </A>
          ),
        },
        { label: 'Description', render: (item) => item.description || '—' },
        { label: 'Members', render: (item) => item.userIds.length },
        {
          label: 'Assignment Group',
          render: (item) => (item.assignmentEnabled ? 'Enabled' : 'Disabled'),
        },
        {
          label: 'Approval Group',
          render: (item) => (item.approvalEnabled ? 'Enabled' : 'Disabled'),
        },
        { label: 'Status', render: (item) => (item.active ? 'Active' : 'Inactive') },
        { label: 'Updated', render: (item) => new Date(item.updatedAt).toLocaleString() },
      ]}
    />
  );
}
