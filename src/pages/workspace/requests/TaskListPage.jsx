import { Show } from 'solid-js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import { statusLabel } from '../../../utils/displayLabels.js';
export default function TaskListPage() {
  const { access } = useWorkspace();
  const canCreate = () => ['admin', 'agent'].includes(access()?.role);
  return (
    <section class="reading-page">
      <Breadcrumbs
        items={[{ label: 'Data Tables', href: '/workspace/data' }, { label: 'Tasks' }]}
      />
      <div class="connections-heading" data-list-actions>
        <h1>Tasks</h1>
        <Show when={canCreate()}>
          <A class="workspace-button small" href="/workspace/tasks/new">
            Add Task
          </A>
        </Show>
      </div>
      <RecordTable
        label="Tasks"
        source="/api/helpdesk/tasks"
        defaultSort={{ key: 'Updated', direction: 'desc' }}
        emptyText="No tasks yet"
        emptyAction={canCreate() ? { label: 'Add Task', href: '/workspace/tasks/new' } : undefined}
        columns={[
          {
            label: 'Task',
            render: (task) => <A href={`/workspace/tasks/${task.id}`}>{task.title}</A>,
          },
          {
            label: 'Status',
            render: (task) =>
              task.status === 'closed' ? 'Closed Complete' : statusLabel(task.status),
          },
          { label: 'Assignment Group', render: (task) => task.queueName || 'Unassigned' },
          { label: 'Assigned To', render: (task) => task.assignedToName || 'Unassigned' },
          {
            label: 'Updated',
            className: 'record-updated-column',
            render: (task) => new Date(task.updatedAt).toLocaleString(),
          },
        ]}
      />
    </section>
  );
}
