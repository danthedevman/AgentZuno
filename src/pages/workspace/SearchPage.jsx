import { useSearchParams } from '@solidjs/router';
import PageHeading from '../../components/PageHeading.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import A from '../../components/WorkspaceLink.jsx';
export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  return (
    <section class="reading-page">
      <PageHeading title="Search" />
      <label class="workspace-search">
        <input
          type="search"
          autofocus
          aria-label="Search workspace"
          placeholder="Search workspace…"
          value={params.q || ''}
          onInput={(event) =>
            setParams({ q: event.currentTarget.value || undefined }, { replace: true })
          }
        />
      </label>
      <RecordTable
        label="Workspace Results"
        source="/api/helpdesk/lists/search"
        query={params.q || ''}
        defaultSort={{ key: 'Name', direction: 'asc' }}
        columns={[
          {
            label: 'Name',
            render: (item) => (
              <A class="record-table-link" href={item.href}>
                {item.title}
              </A>
            ),
          },
          { key: 'type', label: 'Type' },
          { key: 'summary', label: 'Summary' },
        ]}
      />
    </section>
  );
}
