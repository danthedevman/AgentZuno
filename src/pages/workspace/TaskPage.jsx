import { Show, createResource, createSignal, createEffect } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '../../services/api.js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { useToasts } from '../../context/ToastContext.jsx';
import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import ReferenceLookup from '../../components/ReferenceLookup.jsx';
import Dropdown from '../../components/Dropdown.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';

export default function TaskPage() {
  const params = useParams(),
    navigate = useNavigate(),
    path = useWorkspacePath();
  const { access } = useWorkspace(),
    { notify } = useToasts();
  const isNew = () => params.taskId === 'new';
  const [editing, setEditing] = createSignal(false),
    [busy, setBusy] = createSignal(false);
  const [title, setTitle] = createSignal(''),
    [description, setDescription] = createSignal('');
  const [status, setStatus] = createSignal('open'),
    [assignedToId, setAssignedToId] = createSignal('');
  const [requestId, setRequestId] = createSignal(''),
    [requestSearch, setRequestSearch] = createSignal('');
  const [task, { refetch }] = createResource(
    () => !isNew() && params.taskId,
    (id) => api(`/api/helpdesk/tasks/${id}`),
  );
  const canEdit = () =>
    isNew()
      ? ['admin', 'agent'].includes(access()?.role)
      : !task.error && task()?.permissions.canEdit;
  const isEditing = () => isNew() || editing();
  const [assignees] = createResource(
    () => !isNew() && isEditing() && canEdit() && params.taskId,
    (id) => api(`/api/helpdesk/tasks/${id}/assignees`),
  );
  const [requests] = createResource(
    () => isNew() && canEdit() && { q: requestSearch() },
    async ({ q }) =>
      (await api(`/api/helpdesk/requests?list=1&pageSize=20&q=${encodeURIComponent(q)}`)).rows,
  );
  function restore() {
    const value = task();
    if (value) {
      setTitle(value.title);
      setDescription(value.description);
      setStatus(value.status);
      setAssignedToId(value.assignedToId || '');
    }
  }
  createEffect(() => {
    if (!task.error && task()) restore();
  });
  async function save(closeComplete = false) {
    if (busy() || !canEdit()) return;
    setBusy(true);
    try {
      if (isNew()) {
        if (!requestId()) throw new Error('Choose an originating request.');
        const created = await api(`/api/helpdesk/requests/${requestId()}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ title: title(), description: description() }),
        });
        navigate(path(`/workspace/tasks/${created.id}`), { replace: true });
      } else {
        await api(`/api/helpdesk/tasks/${params.taskId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: title(),
            description: description(),
            status: closeComplete ? 'closed' : status(),
            assignedToId: assignedToId(),
            version: task().version,
          }),
        });
        setEditing(false);
        await refetch();
      }
      notify({ tone: 'success', message: closeComplete ? 'Task closed complete.' : 'Task saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="reading-page task-record-page">
      <header class="task-record-header">
        <Breadcrumbs
          items={[
            { label: 'Tasks', href: '/workspace/data/ref-task' },
            { label: isNew() ? 'New Task' : (!task.error && task()?.title) || 'Task' },
          ]}
        />
        <div class="helpdesk-actions">
          <Show when={canEdit() && !isEditing()}>
            <button
              class="workspace-button secondary small"
              disabled={busy()}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          </Show>
          <Show when={!isNew() && canEdit() && task()?.status !== 'closed'}>
            <button class="workspace-button small" disabled={busy()} onClick={() => save(true)}>
              Close Complete
            </button>
          </Show>
        </div>
      </header>
      <Show when={task.loading && !task.latest}>
        <Skeleton label="Loading task" lines={6} />
      </Show>
      <Show when={task.error}>
        <ToastMessage tone="error">{task.error.message}</ToastMessage>
      </Show>
      <Show when={isNew() || (!task.error && task())}>
        <ValidatedForm
          class="create-form task-record-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div class="task-record-layout">
            <section class="task-content-card" aria-label="Task details">
              <label>
                Title
                <input
                  name="title"
                  required
                  maxlength="160"
                  readOnly={!isEditing()}
                  value={title()}
                  onInput={(event) => setTitle(event.currentTarget.value)}
                />
              </label>
              <ReferenceLookup
                label="Originating Request"
                name="request"
                required={isNew()}
                readOnly={!isNew()}
                disabled={busy()}
                value={isNew() ? requestId() : task()?.requestId}
                options={
                  isNew()
                    ? ((!requests.error && requests()) || []).map((record) => ({
                        value: record.id,
                        label: `${record.number} · ${record.title}`,
                      }))
                    : [
                        {
                          value: task()?.requestId,
                          label: task()?.requestReference.label,
                          href: task()?.requestReference.href,
                        },
                      ]
                }
                onSearch={setRequestSearch}
                onChange={setRequestId}
              />
              <label>
                Details
                <textarea
                  name="description"
                  rows="8"
                  maxlength="7000"
                  readOnly={!isEditing()}
                  value={description()}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                />
              </label>
            </section>
            <aside class="task-assignment-card" aria-label="Task assignment">
              <h2>Assignment</h2>
              <label>
                Status
                <Dropdown
                  ariaLabel="Task status"
                  disabled={isNew() || !isEditing() || busy()}
                  value={status()}
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'in-progress', label: 'In Progress' },
                    { value: 'closed', label: 'Closed Complete' },
                  ]}
                  onChange={setStatus}
                />
              </label>
              <Show when={!isNew()}>
                <label>
                  Assignment Group
                  <input readOnly value={task()?.queueName || 'Unassigned'} />
                </label>
                <ReferenceLookup
                  label="Assigned To"
                  placeholder="Unassigned"
                  readOnly={!isEditing()}
                  disabled={busy()}
                  value={assignedToId()}
                  options={
                    (!assignees.error && assignees()) ||
                    (task()?.assignedToId
                      ? [
                          {
                            value: task().assignedToId,
                            label: task().assignedToName || 'Agent',
                            href: `/workspace/users/${task().assignedToId}`,
                          },
                        ]
                      : [])
                  }
                  onChange={setAssignedToId}
                />
              </Show>
            </aside>
          </div>
          <Show when={isEditing() && canEdit()}>
            <div class="helpdesk-actions">
              <button class="workspace-button" disabled={busy() || assignees.loading}>
                {busy() ? 'Saving…' : 'Save'}
              </button>
              <Show when={!isNew()}>
                <button
                  type="button"
                  class="workspace-button secondary"
                  disabled={busy()}
                  onClick={() => {
                    restore();
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              </Show>
            </div>
          </Show>
        </ValidatedForm>
      </Show>
    </section>
  );
}
