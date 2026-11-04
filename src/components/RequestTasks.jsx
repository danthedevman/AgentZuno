import { Show, createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api } from '../services/api.js';
import { useToasts } from '../context/ToastContext.jsx';
import RecordTable from './RecordTable.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import Dropdown from './Dropdown.jsx';

export default function RequestTasks(props) {
  const navigate = useNavigate();
  const { notify } = useToasts();
  const [adding, setAdding] = createSignal(false);
  const [selected, setSelected] = createSignal(null);
  const [status, setStatus] = createSignal('open');
  const [busy, setBusy] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const endpoint = () => `/api/helpdesk/requests/${props.requestId}/tasks`;
  const statusLabel = (value) =>
    ({ open: 'Open', 'in-progress': 'In Progress', closed: 'Closed' })[value];
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
              setSelected(null);
            }}
          >
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
          <div class="helpdesk-actions">
            <button class="workspace-button small" disabled={busy()}>
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
        columns={[
          { label: 'Task', render: (record) => <strong>{record.title}</strong> },
          { label: 'Status', render: (record) => statusLabel(record.status) },
          { label: 'Updated', render: (record) => new Date(record.updatedAt).toLocaleString() },
        ]}
        onRowClick={(record) => {
          setSelected(record);
          setStatus(record.status);
          setAdding(false);
        }}
        emptyText="No tasks associated with this request."
        emptyAction={
          props.canManage ? { label: 'Add Task', onClick: () => setAdding(true) } : undefined
        }
      />
      <Show when={selected()}>
        {(task) => (
          <section class="create-form request-task-details" aria-label="Task details">
            <h3>{task().title}</h3>
            <p>{task().description}</p>
            <p>Assignment Group: {task().queueName}</p>
            <Show when={props.canManage} fallback={<p>Status: {statusLabel(task().status)}</p>}>
              <label>
                Status
                <Dropdown
                  ariaLabel="Task status"
                  value={status()}
                  options={['open', 'in-progress', 'closed'].map((value) => ({
                    value,
                    label: statusLabel(value),
                  }))}
                  onChange={setStatus}
                />
              </label>
              <button
                class="workspace-button small"
                disabled={busy() || status() === task().status}
                onClick={() =>
                  perform(async () => {
                    const result = await api(`${endpoint()}/${task().id}`, {
                      method: 'PUT',
                      body: JSON.stringify({ status: status(), version: task().version }),
                    });
                    setSelected(result);
                    notify({ tone: 'success', message: 'Task updated.' });
                  })
                }
              >
                Save Changes
              </button>
            </Show>
          </section>
        )}
      </Show>
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
