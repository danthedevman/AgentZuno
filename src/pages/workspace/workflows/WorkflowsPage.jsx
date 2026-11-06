import Skeleton from '../../../components/Skeleton.jsx';
import { displayLabel, statusLabel } from '../../../utils/displayLabels.js';
import { Show, createEffect, createResource } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { api } from '../../../services/api.js';
import A from '../../../components/WorkspaceLink.jsx';
import PageHeading from '../../../components/PageHeading.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import Icon from '../../../components/Icon.jsx';

export default function WorkflowsPage() {
  const { access } = useWorkspace();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [query] = useSearchParams();
  const isAdmin = () => !access?.error && access?.()?.role === 'admin';
  const [workflows] = createResource(isAdmin, () => api('/api/helpdesk/workflows'));
  createEffect(() => {
    if (query.new === '1') navigate(path('/workspace/workflows/new'), { replace: true });
  });
  return (
    <section class="reading-page">
      <div class="connections-heading" data-list-actions>
        <PageHeading title="Workflows" />
        <Show when={isAdmin()}>
          <A class="workspace-button small" href="/workspace/workflows/new">
            New workflow
          </A>
        </Show>
      </div>
      <Show
        when={isAdmin()}
        fallback={
          <Show
            when={!access.loading && !!access()}
            fallback={<Skeleton label="Checking administrator access" lines={3} />}
          >
            <ToastMessage tone="error">
              {access.error?.message || 'Administrator access is required.'}
            </ToastMessage>
          </Show>
        }
      >
        <Show when={workflows.error}>
          <ToastMessage tone="error">{workflows.error.message}</ToastMessage>
        </Show>
        <RecordTable
          label="Workflows"
          emptyAction={{ label: 'New Workflow', href: '/workspace/workflows/new' }}
          source="/api/helpdesk/workflows"
          rows={!workflows.error ? workflows() || [] : []}
          columns={[
            {
              label: 'Workflow',
              sortValue: (item) => item.name,
              render: (item) => (
                <A class="article-table-title" href={`/workspace/workflows/${item.id}/edit`}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{displayLabel(item.queueName) || 'No Queue'}</small>
                  </span>
                </A>
              ),
            },
            {
              label: 'Status',
              sortValue: (item) => (item.enabled ? 'Published' : 'Draft'),
              render: (item) => (
                <span
                  class="activity-status"
                  data-tone={item.enabled ? 'positive' : 'informational'}
                >
                  <span class="activity-status-dot" />
                  {item.enabled ? 'Published' : 'Draft'}
                </span>
              ),
            },
            {
              label: 'Updated',
              defaultDirection: 'desc',
              sortValue: (item) => Date.parse(item.updatedAt),
              render: (item) => (
                <time datetime={item.updatedAt}>
                  {new Date(item.updatedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              ),
            },
          ]}
          emptyText={workflows.loading ? 'Loading workflows…' : 'No workflows yet.'}
        />
      </Show>
    </section>
  );
}
