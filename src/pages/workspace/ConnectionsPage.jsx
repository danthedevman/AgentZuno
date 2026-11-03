import RecordTable from '../../components/RecordTable.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import { connectionStatus } from '../../services/connectionStatus.js';
import A from '../../components/WorkspaceLink.jsx';
import { For, Show, createSignal, createResource, createMemo } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import Icon from '../../components/Icon.jsx';
import CategoryDropdown from '../../components/CategoryDropdown.jsx';
import { api } from '../../services/api.js';

export default function ConnectionsPage() {
  const { workspace } = useWorkspace();
  const [catalog] = createResource(() => api('/api/integration-catalog'));
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal('');
  const categories = () =>
    [
      ...new Set(
        (catalog.error ? [] : catalog() || [])
          .filter((item) => item.id === 'servicenow')
          .map((item) => item.category),
      ),
    ].sort((first, second) => first.localeCompare(second));
  const status = (app) => app.status || { label: 'Not Configured', tone: 'muted' };
  return (
    <div class="connections-page reading-page">
      <div class="connections-heading">
        <PageHeading title="Connections" />
        <A class="workspace-button small" href="/workspace/integrations/custom">
          <Icon name="plus" />
          Custom connection
        </A>
      </div>
      <div class="connection-filters">
        <label class="workspace-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search apps"
            placeholder="Search apps…"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <CategoryDropdown categories={categories()} value={category()} onChange={setCategory} />
      </div>
      <Show when={catalog.error}>
        <ToastMessage tone="error">Could not load the app catalog.</ToastMessage>
      </Show>
      <Show when={catalog.loading}>
        <p class="sr-only" role="status">
          Loading apps…
        </p>
      </Show>
      <RecordTable
        label="Knowledge Sources"
        emptyAction={{ label: 'Add Connection', href: '/workspace/integrations/custom' }}
        source="/api/helpdesk/lists/connections"
        query={query()}
        sourceParams={{ category: category() || undefined }}
        rows={[]}
        defaultSort={{ key: 'Connection', direction: 'asc' }}
        columns={[
          {
            label: 'Connection',
            sortValue: (app) => app.name,
            render: (app) => (
              <A class="article-table-title" href={`/workspace/integrations/${app.id}`}>
                <span class="activity-type-badge" data-type="article">
                  <Icon name="plug" />
                </span>
                <span>
                  <strong>{app.name}</strong>
                  <small>{app.connection?.name || app.category}</small>
                </span>
              </A>
            ),
          },
          { label: 'Category', sortValue: (app) => app.category, render: (app) => app.category },
          {
            label: 'Status',
            sortValue: (app) => status(app).label,
            render: (app) => (
              <span class="activity-status" data-tone={status(app).tone}>
                <span class="activity-status-dot" />
                {status(app).label}
              </span>
            ),
          },
        ]}
        emptyText={catalog.loading ? 'Loading connections…' : 'No connections match your search.'}
      />
    </div>
  );
}
