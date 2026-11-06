import RecordTable from '../../../components/records/RecordTable.jsx';
import PageHeading from '../../../components/PageHeading.jsx';
import A from '../../../components/WorkspaceLink.jsx';
export default function ApprovalsPage() {
  return (
    <section class="reading-page">
      <PageHeading title="Approvals" />
      <RecordTable
        label="Approvals"
        source="/api/helpdesk/my-approvals"
        rows={[]}
        defaultSort={{ key: 'Updated', direction: 'desc' }}
        emptyText="No approvals awaiting your decision."
        columns={[
          {
            label: 'Request',
            render: (item) => (
              <A
                class="article-table-title"
                href={
                  item.chatId
                    ? `/workspace/chat/${item.chatId}?request=${item.requestId}`
                    : `/workspace/requests/${item.requestId}`
                }
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.number}</small>
                </span>
              </A>
            ),
          },
          { label: 'Reason', render: (item) => item.reason },
          { label: 'Updated', render: (item) => new Date(item.updatedAt).toLocaleString() },
        ]}
      />
    </section>
  );
}
