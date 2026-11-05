import BackLink from '../../components/BackLink.jsx';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import MultiSelectLookup from '../../components/MultiSelectLookup.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import A from '../../components/WorkspaceLink.jsx';
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
  createEffect(() => {
    if (!record.error && record()) {
      setName(record().name);
      setDescription(record().description || '');
      setInstructions(record().routingInstructions || '');
      setMemberIds(record().agentIds || record().userIds || []);
      setActive(record().active !== false);
      setAssignmentEnabled(!!record().assignmentEnabled);
      setApprovalEnabled(!!record().approvalEnabled);
    }
  });
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
      notify({ tone: 'success', message: 'Group saved.' });
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
      <div class="connections-heading">
        <PageHeading title={isNew() ? 'New Group' : name() || 'Group'} />
        <Show when={isAdmin()}>
          <Show
            when={editing()}
            fallback={
              <button type="button" class="workspace-button small" onClick={() => setEditing(true)}>
                Edit
              </button>
            }
          >
            <button class="workspace-button small" form="queue-form" disabled={saving()}>
              {saving() ? 'Saving…' : 'Save'}
            </button>
          </Show>
        </Show>
      </div>

      <Show when={record.error}>
        <ToastMessage tone="error">{record.error.message}</ToastMessage>
      </Show>
      <Show
        when={isAdmin() && (isNew() || (!record.error && record()))}
        fallback={<Skeleton label="Loading fields" lines={5} />}
      >
        <ValidatedForm id="queue-form" class="create-form data-record-form" onSubmit={save}>
          <label>
            Name
            <input
              name="name"
              required
              maxlength="80"
              value={name()}
              readOnly={!editing() || (!isNew() && record()?.assignmentEnabled)}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label>
            Description
            <input
              name="description"
              maxlength="1000"
              value={description()}
              readOnly={!editing()}
              onInput={(event) => setDescription(event.currentTarget.value)}
            />
          </label>
          <fieldset class="group-settings">
            <legend>Group Settings</legend>
            <For
              each={[
                { label: 'Assignment Group', value: assignmentEnabled, set: setAssignmentEnabled },
                { label: 'Approval Group', value: approvalEnabled, set: setApprovalEnabled },
              ]}
            >
              {(toggle) => (
                <>
                  <div class="preference-row">
                    <span>{toggle.label}</span>
                    <button
                      type="button"
                      class="toggle-switch"
                      role="switch"
                      aria-label={toggle.label}
                      aria-checked={toggle.value()}
                      disabled={!editing()}
                      onClick={() => toggle.set(!toggle.value())}
                    >
                      <span />
                    </button>
                  </div>
                  <Show when={toggle.label === 'Assignment Group'}>
                    {' '}
                    <Show when={assignmentEnabled()}>
                      <label>
                        Routing Instructions
                        <textarea
                          name="routingInstructions"
                          maxlength="2000"
                          rows="5"
                          value={instructions()}
                          readOnly={!editing()}
                          onInput={(event) => setInstructions(event.currentTarget.value)}
                        />
                      </label>
                    </Show>
                  </Show>
                </>
              )}
            </For>
          </fieldset>

          <MultiSelectLookup
            name="members"
            label="Members"
            value={memberIds()}
            onChange={setMemberIds}
            readOnly={!editing()}
            options={(!members.error ? members() || [] : [])
              .filter((member) => member.active)
              .map((member) => ({
                value: member.userId,
                label: member.name || member.email,
                href: `/workspace/users/${member.userId}`,
              }))}
          />
          <Show when={true}>
            <div class="preference-row">
              <span>Active</span>
              <button
                type="button"
                class="toggle-switch"
                role="switch"
                aria-label="Active group"
                aria-checked={active()}
                disabled={!editing()}
                onClick={() => setActive(!active())}
              >
                <span />
              </button>
            </div>
          </Show>
        </ValidatedForm>
      </Show>
    </section>
  );
}
