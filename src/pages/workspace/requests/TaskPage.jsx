import RecordActivity from '../../../components/records/RecordActivity.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';
import RecordValue from '../../../components/records/RecordValue.jsx';
import { Show, createResource, createSignal, createEffect } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '../../../services/api.js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { useToasts } from '../../../context/ToastContext.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import ValidatedForm from '../../../components/ValidatedForm.jsx';
import ReferenceLookup from '../../../components/ReferenceLookup.jsx';
import Dropdown from '../../../components/Dropdown.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';

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
  const [dueDate, setDueDate] = createSignal('');
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
      setDueDate(value.dueDate || '');
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
          body: JSON.stringify({ title: title(), description: description(), dueDate: dueDate() }),
        });
        notify({
          tone: 'success',
          message: 'Task saved.',
          destination: path(`/workspace/tasks/${created.id}`),
        });
        navigate(path(`/workspace/tasks/${created.id}`), { replace: true });
        return;
      } else {
        await api(`/api/helpdesk/tasks/${params.taskId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: title(),
            description: description(),
            dueDate: dueDate(),
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
      <div class="record-page-breadcrumbs">
        <Breadcrumbs
          items={[
            { label: 'Tasks', href: '/workspace/data/ref-task' },
            { label: isNew() ? 'New Task' : 'Task' },
          ]}
        />
      </div>
      <RecordHeader
        title={isNew() ? 'New Task' : (!task.error && task()?.title) || 'Task'}
        context={
          !isNew() && !task.error && task()?.updatedAt
            ? `Updated ${new Date(task().updatedAt).toLocaleString()}`
            : undefined
        }
      >
        <Show when={canEdit() && !isEditing()}>
          <button
            class="workspace-button secondary small"
            disabled={busy()}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        </Show>
        <Show when={!isNew() && canEdit() && task()?.status !== 'closed' && !isEditing()}>
          <button class="workspace-button small" disabled={busy()} onClick={() => save(true)}>
            Close Complete
          </button>
        </Show>
      </RecordHeader>
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
          <section class="record-surface record-property-sheet" aria-label="Task details">
            <div class="record-property-list">
              <div class="record-field-full">
                <Show when={isEditing()} fallback={<RecordValue label="Title" value={title()} />}>
                  <label>
                    Title
                    <input
                      name="title"
                      required
                      maxlength="160"
                      value={title()}
                      onInput={(event) => setTitle(event.currentTarget.value)}
                    />
                  </label>
                </Show>
              </div>

              <Show
                when={isEditing()}
                fallback={
                  <RecordValue
                    label="Status"
                    badge={status()}
                    value={
                      status() === 'closed'
                        ? 'Closed Complete'
                        : status() === 'in-progress'
                          ? 'In Progress'
                          : 'Open'
                    }
                  />
                }
              >
                <label>
                  Status
                  <Dropdown
                    ariaLabel="Task status"
                    disabled={isNew() || busy()}
                    value={status()}
                    options={[
                      { value: 'open', label: 'Open' },
                      { value: 'in-progress', label: 'In Progress' },
                      { value: 'closed', label: 'Closed Complete' },
                    ]}
                    onChange={setStatus}
                  />
                </label>
              </Show>
              <Show when={!isNew()}>
                <Show
                  when={isEditing()}
                  fallback={
                    <RecordValue
                      label="Assignment Group"
                      value={task()?.queueName || 'Unassigned'}
                    />
                  }
                >
                  <label>
                    Assignment Group
                    <input readOnly value={task()?.queueName || 'Unassigned'} />
                  </label>
                </Show>
                <Show
                  when={isEditing()}
                  fallback={
                    <RecordValue
                      label="Assigned To"
                      value={task()?.assignedToName || 'Unassigned'}
                      avatarId={task()?.assignedToId}
                      avatarName={task()?.assignedToName}
                      href={
                        task()?.assignedToId ? `/workspace/users/${task().assignedToId}` : undefined
                      }
                    />
                  }
                >
                  <ReferenceLookup
                    label="Assigned To"
                    placeholder="Unassigned"
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
              </Show>
              <Show
                when={isEditing()}
                fallback={
                  <RecordValue
                    label="Originating Request"
                    value={task()?.requestReference?.label}
                    href={task()?.requestReference?.href}
                  />
                }
              >
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
                            label: task()?.requestReference?.label,
                            href: task()?.requestReference?.href,
                          },
                        ]
                  }
                  onSearch={setRequestSearch}
                  onChange={setRequestId}
                />
              </Show>

              <Show
                when={isEditing()}
                fallback={
                  <RecordValue
                    label="Due Date"
                    value={
                      dueDate() ? new Date(dueDate() + 'T12:00:00').toLocaleDateString() : 'Not Set'
                    }
                  />
                }
              >
                <label>
                  Due Date
                  <input
                    name="dueDate"
                    type="date"
                    min="1900-01-01"
                    max="9999-12-31"
                    value={dueDate()}
                    onInput={(event) => setDueDate(event.currentTarget.value)}
                  />
                </label>
              </Show>
              <Show when={!isNew() && task()?.createdAt}>
                <RecordValue label="Created" value={new Date(task().createdAt).toLocaleString()} />
              </Show>
            </div>
            <div
              class="record-description-field"
              classList={{ 'record-description-block': !isEditing() }}
            >
              <div class="record-field-full">
                <Show
                  when={isEditing()}
                  fallback={<RecordValue label="Details" value={description()} />}
                >
                  <label>
                    Details
                    <textarea
                      name="description"
                      rows="6"
                      maxlength="7000"
                      value={description()}
                      onInput={(event) => setDescription(event.currentTarget.value)}
                    />
                  </label>
                </Show>
              </div>
            </div>
          </section>
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
        <Show when={!isNew()}>
          <RecordActivity kind="task" recordId={params.taskId} />
        </Show>
      </Show>
    </section>
  );
}
