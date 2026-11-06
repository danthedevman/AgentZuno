import { useSession } from '../../context/SessionContext.jsx';
import { createResource, createSignal, createEffect, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { api } from '../../services/api.js';
import { confirmAction } from '../../services/confirmations.js';
import { useToasts } from '../../context/ToastContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import Dropdown from '../Dropdown.jsx';
import MultiSelectLookup from '../MultiSelectLookup.jsx';
import Toggle from '../Toggle.jsx';
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
        <ValidatedForm class="create-form" onSubmit={save}>
          <label>
            Role
            <Dropdown
              ariaLabel="User role"
              value={draft().role}
              options={['admin', 'agent', 'user', 'read-only'].map((value) => ({
                value,
                label:
                  value === 'read-only' ? 'Read Only' : value[0].toUpperCase() + value.slice(1),
              }))}
              onChange={(value) => {
                change('role', value);
                if (['user', 'read-only'].includes(value)) change('queues', []);
              }}
            />
          </label>
          <Show when={['admin', 'agent'].includes(draft().role)}>
            <MultiSelectLookup
              label="Assignment Groups"
              value={draft().queues || []}
              disabled={groups.loading || !!groups.error}
              options={(groups.error ? [] : groups() || []).map((group) => ({
                value: group.name,
                label: group.name,
                href: `/workspace/users/groups/${group.groupId || group.id}`,
              }))}
              onChange={(value) => change('queues', value)}
            />
          </Show>
          <Toggle
            label="Active"
            disabled={props.userId === session()?.user?.id}
            checked={draft().active}
            onChange={(value) => change('active', value)}
          />
          <Toggle
            label="Can Approve"
            checked={draft().canApprove}
            disabled={draft().role === 'read-only'}
            onChange={(value) => change('canApprove', value)}
          />
          <div class="helpdesk-actions">
            <button type="submit" class="workspace-button" disabled={busy()}>
              Save Access
            </button>
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
        </ValidatedForm>
      </Show>
    </section>
  );
}
