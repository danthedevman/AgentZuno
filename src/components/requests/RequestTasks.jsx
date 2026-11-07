import Icon from '../Icon.jsx';
import A from '../WorkspaceLink.jsx';
import ProfileAvatar from '../identity/ProfileAvatar.jsx';
import { Show, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import RecordTable from '../records/RecordTable.jsx';
import ValidatedForm from '../ValidatedForm.jsx';

export default function RequestTasks(props) {
  const navigate = useNavigate();
  const { notify } = useToasts();
  const [adding, setAdding] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const endpoint = () => `/api/helpdesk/requests/${props.requestId}/tasks`;
  const statusLabel = (value) =>
    ({ open: 'Open', 'in-progress': 'In Progress', closed: 'Closed Complete' })[value];
  async function perform(action) {
    setBusy(true);
    try {
      await action();
      setRevision((value) => value + 1);
      await props.onChanged?.();
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="request-tasks">
      <div class="request-tasks-toolbar">
        <h3>Tasks</h3>
        <Show when={props.canManage}>
          <button
            class="workspace-button small"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Icon name="plus" />
            Add Task
          </button>
        </Show>
      </div>
      <Show when={adding() && props.canManage}>
        <ValidatedForm
          class="create-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            perform(async () => {
              await api(endpoint(), {
                method: 'POST',
                body: JSON.stringify({
                  title: form.get('title'),
                  description: form.get('description'),
                  dueDate: form.get('dueDate') || '',
                }),
              });
              setAdding(false);
              notify({ tone: 'success', message: 'Task created.' });
            });
          }}
        >
          <label>
            Title
            <input name="title" required maxlength="160" />
          </label>
          <label>
            Details
            <textarea name="description" maxlength="7000" />
          </label>
          <label>
            Due Date
            <input name="dueDate" type="date" min="1900-01-01" max="9999-12-31" />
          </label>
          <div class="helpdesk-actions">
            <button class="workspace-button small" disabled={busy()}>
              <Icon name="plus" />
              Create Task
            </button>
            <button
              type="button"
              class="workspace-button secondary small"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </ValidatedForm>
      </Show>
      <RecordTable
        label="Request Tasks"
        source={endpoint()}
        refreshKey={`${revision()}:${props.refreshKey || 0}`}
        renderCard={(task) => (
          <A class="request-task-card" href={`/workspace/tasks/${task.id}`}>
            <div class="request-task-card-heading">
              <strong>{task.title}</strong>
              <span class="inbox-status-badge" data-status={task.status}>
                {statusLabel(task.status)}
              </span>
            </div>
            <Show when={task.description}>
              <p>{task.description}</p>
            </Show>
            <div class="request-task-card-meta">
              <span>{task.queueName || 'Unassigned'}</span>
              <span>
                <ProfileAvatar
                  userId={task.assignedToId}
                  name={task.assignedToName || 'Unassigned'}
                />
                {task.assignedToName || 'Unassigned'}
              </span>
            </div>
            <Show when={task.dueDate}>
              <span class="request-task-due">
                Due {new Date(task.dueDate + 'T12:00:00').toLocaleDateString()}
              </span>
            </Show>
            <time datetime={task.updatedAt}>
              Updated {new Date(task.updatedAt).toLocaleString()}
            </time>
          </A>
        )}
        columns={[
          { label: 'Task', render: (record) => <strong>{record.title}</strong> },
          { label: 'Status', render: (record) => statusLabel(record.status) },
          { label: 'Updated', render: (record) => new Date(record.updatedAt).toLocaleString() },
        ]}
        emptyText="No tasks associated with this request."
        emptyAction={
          props.canManage ? { label: 'Add Task', onClick: () => setAdding(true) } : undefined
        }
      />
      <Show when={props.canManage}>
        <ValidatedForm
          class="create-form request-task-assistant"
          onSubmit={(event) => {
            event.preventDefault();
            const text = new FormData(event.currentTarget).get('text');
            perform(async () => {
              const chat = await api('/api/helpdesk/support/conversations', {
                method: 'POST',
                body: JSON.stringify({
                  requestId: crypto.randomUUID(),
                  relatedRequestId: props.requestId,
                  text,
                }),
              });
              navigate(
                `/workspace/${props.workspaceId}/chat/${chat.id}?request=${props.requestId}`,
              );
            });
          }}
        >
          <label>
            Ask Zuno
            <input
              name="text"
              required
              maxlength="7000"
              placeholder="Create a setup task or help close an existing task…"
            />
          </label>
          <button class="workspace-button secondary small" disabled={busy()}>
            Ask Zuno
          </button>
        </ValidatedForm>
      </Show>
    </section>
  );
}
