import RecordForm from '../../../components/records/RecordForm.jsx';
import RecordActivity from '../../../components/records/RecordActivity.jsx';
import BackLink from '../../../components/BackLink.jsx';
import { Show, createEffect, createResource, createSignal } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { api } from '../../../services/api.js';
import { useToasts } from '../../../context/ToastContext.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
export default function QueuePage(props) {
  const params = useParams();
  const { access } = useWorkspace();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const { notify } = useToasts();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const isNew = () => params.id === 'new';
  const endpoint = () => '/api/helpdesk/groups';
  const [record, { refetch }] = createResource(
    () => isAdmin() && !isNew() && `${endpoint()}/${params.id}`,
    (url) => api(url),
  );
  const [members] = createResource(isAdmin, () => api('/api/helpdesk/members'));
  const [editing, setEditing] = createSignal(isNew());
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [instructions, setInstructions] = createSignal('');
  const [memberIds, setMemberIds] = createSignal([]);
  const [active, setActive] = createSignal(true);
  const [assignmentEnabled, setAssignmentEnabled] = createSignal(true);
  const [approvalEnabled, setApprovalEnabled] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  function restore() {
    const value = !record.error && record();
    if (!value) return;
    setName(value.name);
    setDescription(value.description || '');
    setInstructions(value.routingInstructions || '');
    setMemberIds(value.agentIds || value.userIds || []);
    setActive(value.active !== false);
    setAssignmentEnabled(!!value.assignmentEnabled);
    setApprovalEnabled(!!value.approvalEnabled);
  }
  createEffect(restore);
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await api(`${endpoint()}${isNew() ? '' : `/${params.id}`}`, {
        method: isNew() ? 'POST' : 'PUT',
        body: JSON.stringify({
          name: name(),
          description: description(),
          userIds: memberIds(),
          active: active(),
          assignmentEnabled: assignmentEnabled(),
          approvalEnabled: approvalEnabled(),
          routingInstructions: instructions(),
          ...(isNew() ? {} : { version: record().version }),
        }),
      });
      notify({
        tone: 'success',
        message: 'Group saved.',
        destination: isNew() ? path(`/workspace/users/groups/${saved.id}`) : undefined,
      });
      setEditing(false);
      if (isNew())
        navigate(path(`/workspace/users/groups/${saved.id}`), {
          replace: true,
        });
      else await refetch();
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page">
      <BackLink href="/workspace/users?tab=groups">Groups</BackLink>
      <RecordHeader title={isNew() ? 'New Group' : (!record.error && record()?.name) || 'Group'}>
        <Show when={isAdmin()}>
          <Show
            when={editing()}
            fallback={
              <button type="button" class="workspace-button small" onClick={() => setEditing(true)}>
                Edit
              </button>
            }
          >
            <div class="helpdesk-actions">
              <button
                type="button"
                class="workspace-button secondary small"
                disabled={saving()}
                onClick={() => {
                  if (isNew()) navigate(path('/workspace/users?tab=groups'));
                  else {
                    restore();
                    setEditing(false);
                  }
                }}
              >
                Cancel
              </button>
              <button class="workspace-button small" form="queue-form" disabled={saving()}>
                {saving() ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Show>
        </Show>
      </RecordHeader>

      <Show when={record.error}>
        <ToastMessage tone="error">{record.error.message}</ToastMessage>
      </Show>
      <Show
        when={isAdmin() && (isNew() || (!record.error && record()))}
        fallback={<Skeleton label="Loading fields" lines={5} />}
      >
        <RecordForm
          id="queue-form"
          sections={[
            {
              title: 'Group Details',
              fields: [
                {
                  id: 'name',
                  label: 'Name',
                  type: 'text',
                  required: true,
                  maxLength: 80,
                  readOnly: !isNew() && record()?.assignmentEnabled,
                },
                {
                  id: 'description',
                  label: 'Description',
                  type: 'textarea',
                  maxLength: 1000,
                  rows: 4,
                  descriptionBlock: true,
                },
                { id: 'active', label: 'Active', type: 'boolean' },
              ],
            },
            {
              title: 'Group Settings',
              fields: [
                { id: 'assignmentEnabled', label: 'Assignment Group', type: 'boolean' },
                {
                  id: 'routingInstructions',
                  label: 'Routing Instructions',
                  type: 'textarea',
                  maxLength: 2000,
                  visible: assignmentEnabled(),
                },
                { id: 'approvalEnabled', label: 'Approval Group', type: 'boolean' },
              ],
            },
            {
              title: 'Membership',
              fields: [
                {
                  id: 'memberIds',
                  label: 'Members',
                  type: 'reference',
                  multiple: true,
                  options: ((!members.error && members()) || [])
                    .filter((member) => member.active || memberIds().includes(member.userId))
                    .map((member) => ({
                      value: member.userId,
                      label: member.name || member.email,
                      href: `/workspace/users/${member.userId}`,
                    })),
                },
              ],
            },
          ]}
          values={{
            name: name(),
            description: description(),
            active: active(),
            assignmentEnabled: assignmentEnabled(),
            approvalEnabled: approvalEnabled(),
            routingInstructions: instructions(),
            memberIds: memberIds(),
          }}
          detailsOnly={!editing()}
          readOnly={!editing()}
          disabled={saving()}
          onChange={(key, value) =>
            ({
              name: setName,
              description: setDescription,
              active: setActive,
              assignmentEnabled: setAssignmentEnabled,
              approvalEnabled: setApprovalEnabled,
              routingInstructions: setInstructions,
              memberIds: setMemberIds,
            })[key](value)
          }
          onSubmit={save}
        />
        <Show when={!isNew()}>
          <RecordActivity kind="group" recordId={params.id} />
        </Show>
      </Show>
    </section>
  );
}
