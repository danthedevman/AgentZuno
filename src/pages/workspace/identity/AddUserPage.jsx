import Icon from '../../../components/Icon.jsx';
import { Show, createResource, createSignal } from 'solid-js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useToasts } from '../../../context/ToastContext.jsx';
import { api } from '../../../services/api.js';
import BackLink from '../../../components/BackLink.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';
import RecordForm from '../../../components/records/RecordForm.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import { canAssignGroups, roleOptions } from '../../../utils/roles.js';

export default function AddUserPage() {
  const { access } = useWorkspace();
  const { notify } = useToasts();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const [provisioning] = createResource(isAdmin, () => api('/api/helpdesk/provisioning'));
  const [groups] = createResource(isAdmin, () => api('/api/helpdesk/queues'));
  const [values, setValues] = createSignal({
    email: '',
    role: 'user',
    queues: [],
    canApprove: false,
  });
  const [saving, setSaving] = createSignal(false);
  const [result, setResult] = createSignal(null);
  const canCreate = () =>
    isAdmin() && !provisioning.loading && !provisioning.error && !provisioning()?.enabled;
  function change(key, value) {
    setValues((previous) => ({
      ...previous,
      [key]: value,
      ...(key === 'role' && !canAssignGroups(value)
        ? { queues: [], ...(value === 'read-only' ? { canApprove: false } : {}) }
        : {}),
    }));
  }
  const sections = () => [
    {
      fields: [{ id: 'email', label: 'Email', type: 'email', required: true, maxLength: 254 }],
    },
    {
      title: 'Workspace Access',
      fields: [
        { id: 'role', label: 'Role', type: 'select', options: roleOptions, required: true },
        {
          id: 'queues',
          label: 'Assignment Groups',
          type: 'reference',
          multiple: true,
          visible: canAssignGroups(values().role),
          options: (groups.error ? [] : groups() || []).map((group) => ({
            value: group.name,
            label: group.name,
            href: `/workspace/users/groups/${group.groupId || group.id}`,
          })),
        },
        {
          id: 'canApprove',
          label: 'Can Approve',
          type: 'boolean',
          readOnly: values().role === 'read-only',
        },
      ],
    },
  ];
  async function save(event) {
    event.preventDefault();
    if (!canCreate() || saving() || result()) return;
    setSaving(true);
    try {
      const saved = await api('/api/helpdesk/invitations', {
        method: 'POST',
        body: JSON.stringify({ ...values(), active: true }),
      });
      setResult(saved);
      notify({
        tone: 'success',
        message:
          saved.delivery === 'manual'
            ? 'Invitation created. Copy and share the invitation link.'
            : 'Invitation queued for email delivery.',
      });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page">
      <BackLink href="/workspace/users">Users</BackLink>
      <RecordHeader title={result() ? 'Invitation Created' : 'Add User'}>
        <Show when={canCreate() && !result()}>
          <A class="workspace-button secondary small" href="/workspace/users">
            Cancel
          </A>
          <button form="add-user-form" class="workspace-button small" disabled={saving()}>
            <Icon name="send" />

            {saving() ? 'Inviting…' : 'Send Invitation'}
          </button>
        </Show>
      </RecordHeader>
      <Show when={!access.loading && access() && !isAdmin()}>
        <ToastMessage tone="error">Administrator access is required.</ToastMessage>
      </Show>
      <Show when={isAdmin()}>
        <Show when={provisioning.loading}>
          <Skeleton label="Loading user settings" lines={3} />
        </Show>
        <Show when={provisioning.error}>
          <ToastMessage tone="error">{provisioning.error.message}</ToastMessage>
        </Show>
        <Show when={!provisioning.error && provisioning()?.enabled}>
          <p>Users are managed by your identity provider.</p>
        </Show>
        <Show when={canCreate()}>
          <Show
            when={!result()}
            fallback={
              <section class="record-section">
                <p>{values().email} has been invited to this workspace.</p>
                <Show
                  when={result()?.invitationUrl}
                  fallback={<p>The invitation is queued for email delivery.</p>}
                >
                  <label class="invitation-share-link">
                    Invitation Link
                    <input
                      readonly
                      value={result()?.invitationUrl}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <button
                    class="workspace-button secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result().invitationUrl);
                        notify({ tone: 'success', message: 'Invitation link copied.' });
                      } catch {
                        notify({
                          tone: 'error',
                          message: 'Could not copy the link. Select and copy it manually.',
                        });
                      }
                    }}
                  >
                    Copy Invitation Link
                  </button>
                </Show>
                <A class="workspace-button secondary" href="/workspace/users?tab=invitations">
                  View Invitations
                </A>
              </section>
            }
          >
            <RecordForm
              id="add-user-form"
              sections={sections()}
              values={values()}
              disabled={saving()}
              onChange={change}
              onSubmit={save}
            />
          </Show>
        </Show>
      </Show>
    </section>
  );
}
