import Icon from '../Icon.jsx';
import RecordForm from '../records/RecordForm.jsx';
import { roleOptions, canAssignGroups } from '../../utils/roles.js';
import { useSession } from '../../context/SessionContext.jsx';
import { createResource, createSignal, createEffect, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { api } from '../../services/api.js';
import { confirmAction } from '../../services/confirmations.js';
import { useToasts } from '../../context/ToastContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';
export default function UserMembershipSettings(props) {
  const { session } = useSession();
  const { access } = useWorkspace(),
    { notify } = useToasts();
  const navigate = useNavigate(),
    path = useWorkspacePath();
  const [members, { refetch }] = createResource(
    () => props.userId,
    () => api('/api/helpdesk/members'),
  );
  const [provisioning] = createResource(() => api('/api/helpdesk/provisioning'));
  const [groups] = createResource(() => api('/api/helpdesk/queues'));
  const member = () => !members.error && members()?.find((item) => item.userId === props.userId);
  const [draft, setDraft] = createSignal({});
  const [busy, setBusy] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  createEffect(() => {
    const item = member();
    if (item)
      setDraft({
        role: item.role,
        queues: item.queues,
        active: item.active,
        canApprove: item.canApprove,
        version: item.version,
      });
  });
  const change = (key, value) => setDraft({ ...draft(), [key]: value });
  async function save() {
    setBusy(true);
    try {
      await api(`/api/helpdesk/members/${props.userId}`, {
        method: 'PUT',
        body: JSON.stringify(draft()),
      });
      await refetch();
      setEditing(false);
      notify({ tone: 'success', message: 'User settings saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="profile-account-settings">
      <h2>Workspace Access</h2>
      <Show when={members.loading}>
        <Skeleton lines={3} />
      </Show>
      <Show when={members.error}>
        <ToastMessage tone="error">{members.error.message}</ToastMessage>
      </Show>
      <Show when={member()}>
        <RecordForm
          sections={[
            {
              fields: [
                { id: 'role', label: 'Role', type: 'select', options: roleOptions },
                {
                  id: 'queues',
                  label: 'Assignment Groups',
                  type: 'reference',
                  multiple: true,
                  visible: canAssignGroups(draft().role),
                  options: (groups.error ? [] : groups() || []).map((group) => ({
                    value: group.name,
                    label: group.name,
                    href: `/workspace/users/groups/${group.groupId || group.id}`,
                  })),
                },
                {
                  id: 'active',
                  label: 'Active',
                  type: 'boolean',
                  readOnly: props.userId === session()?.user?.id,
                },
                {
                  id: 'canApprove',
                  label: 'Can Approve',
                  type: 'boolean',
                  readOnly: draft().role === 'read-only',
                },
              ],
            },
          ]}
          values={draft()}
          detailsOnly={!editing()}
          disabled={busy()}
          onChange={(key, value) => {
            change(key, value);
            if (key === 'role' && !canAssignGroups(value)) change('queues', []);
            if (key === 'role' && value === 'read-only') change('canApprove', false);
          }}
          onSubmit={save}
        >
          <div class="helpdesk-actions">
            <Show
              when={editing()}
              fallback={
                <button
                  type="button"
                  class="workspace-button secondary"
                  onClick={() => setEditing(true)}
                >
                  Edit Access
                </button>
              }
            >
              <button type="submit" class="workspace-button" disabled={busy()}>
                <Icon name="save" />
                Save Access
              </button>
              <button
                type="button"
                class="workspace-button secondary"
                disabled={busy()}
                onClick={() => {
                  const item = member();
                  setDraft({
                    role: item.role,
                    queues: item.queues,
                    active: item.active,
                    canApprove: item.canApprove,
                    version: item.version,
                  });
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </Show>
            <Show
              when={
                !provisioning.loading &&
                !provisioning.error &&
                !provisioning()?.enabled &&
                props.userId !== session()?.user?.id &&
                props.userId !== access()?.ownerId
              }
            >
              <button
                type="button"
                class="workspace-button secondary"
                disabled={busy()}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      `Remove ${member().name || member().email} from this workspace? Their account and audit history are retained.`,
                      'Remove User',
                      'Remove User',
                    ))
                  )
                    return;
                  setBusy(true);
                  try {
                    await api(`/api/helpdesk/members/${props.userId}`, {
                      method: 'DELETE',
                      confirmed: true,
                      body: JSON.stringify({ confirmed: true, version: member().version }),
                    });
                    navigate(path('/workspace/users'));
                    notify({
                      tone: 'success',
                      message: 'User removed from workspace.',
                      destination: path('/workspace/users'),
                    });
                  } catch (error) {
                    notify({ tone: 'error', message: error.message });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Remove User
              </button>
            </Show>
          </div>
        </RecordForm>
      </Show>
    </section>
  );
}
