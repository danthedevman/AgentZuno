import ApprovalGroupList from '../../components/ApprovalGroupList.jsx';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import Icon from '../../components/Icon.jsx';
import WorkforceProfile from '../../components/WorkforceProfile.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import WorkspaceModal from '../../components/WorkspaceModal.jsx';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import PageHeading from '../../components/PageHeading.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import Dropdown from '../../components/Dropdown.jsx';
import MultiSelectLookup from '../../components/MultiSelectLookup.jsx';

export default function UsersPage() {
  const [isListEmpty, setIsListEmpty] = createSignal(false);
  const { access } = useWorkspace();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [routeQuery, setRouteQuery] = useSearchParams();
  const isAdmin = () => !access?.error && access?.()?.role === 'admin';
  const [members, { refetch }] = createResource(isAdmin, () => api('/api/helpdesk/members'));
  const [profiles, { refetch: refreshProfiles }] = createResource(isAdmin, () =>
    api('/api/helpdesk/workforce-profiles'),
  );
  const profileFor = (id) =>
    !profiles.error && profiles()?.find((profile) => profile.userId === id);
  const profileLabel = (id, key) => {
    const profile = profileFor(id);
    return profile?.labels[profile?.fields[key]] || profile?.fields[key] || '';
  };
  const [settings] = createResource(isAdmin, () => api('/api/helpdesk/settings'));
  const [provisioning, { refetch: refreshProvisioning }] = createResource(isAdmin, () =>
    api('/api/helpdesk/provisioning'),
  );
  const [directory] = createResource(isAdmin, () => api('/api/helpdesk/directory-users'));
  const [isFormOpen, setIsFormOpen] = createSignal(false);
  function openUser(member = null) {
    if (member) {
      navigate(path(`/workspace/users/${member.userId || member.id}`));
      return;
    }
    if (!member && (provisioning.loading || provisioning.error || provisioning()?.enabled)) return;
    setSelected(member);
    setError('');
    setMessage('');
    setIsFormOpen(true);
  }
  const [selected, setSelected] = createSignal(null);
  const [role, setRole] = createSignal('user');
  const [queues, setQueues] = createSignal([]);
  const [active, setActive] = createSignal(true);
  const [canApprove, setCanApprove] = createSignal(false);
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [token, setToken] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [tab, setTab] = createSignal(
    ['users', 'groups', 'invitations'].includes(routeQuery.tab) ? routeQuery.tab : 'users',
  );
  const [savedQueues, { refetch: refreshQueues }] = createResource(isAdmin, () =>
    api('/api/helpdesk/queues'),
  );
  function switchTab(value) {
    setTab(value);
    setRouteQuery({ tab: value });
    setQuery('');
  }
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const values = ['users', 'groups', 'invitations'];
    const index = values.indexOf(tab());
    const next =
      values[
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 2
            : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3
      ];
    switchTab(next);
    document.getElementById(`users-tab-${next}`)?.focus();
  }
  createEffect(() => {
    const member = selected();
    setRole(member?.role || 'user');
    setQueues(member?.queues || []);
    setActive(member?.active ?? true);
    setCanApprove(member?.canApprove || false);
  });
  const queueOptions = () =>
    [
      ...new Set([
        ...(!savedQueues.error ? savedQueues() || [] : []).map((queue) => queue.name),
        ...(!settings.error ? settings()?.routing || [] : []).map((item) => item.queueName),
        ...(!members.error ? members() || [] : []).flatMap((item) => item.queues),
      ]),
    ]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => {
        const group = (!savedQueues.error ? savedQueues() || [] : []).find(
          (item) => item.name === value,
        );
        return {
          value,
          label: value,
          href: group ? `/workspace/users/groups/${group.groupId || group.id}` : undefined,
        };
      });
  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const member = selected();
    try {
      await api(member ? `/api/helpdesk/members/${member.userId}` : '/api/helpdesk/invitations', {
        method: member ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...(member ? { version: member.version } : { email: form.get('email') }),
          role: role(),
          queues: ['admin', 'agent'].includes(role()) ? queues() : [],
          canApprove: canApprove(),
          active: active(),
        }),
      });
      setSelected(null);
      formElement.reset();
      await refetch();
      setMessage(member ? 'User saved.' : 'Invitation queued for email delivery.');
      setIsFormOpen(false);
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page helpdesk-page users-page">
      <div class="connections-heading" data-list-actions>
        <PageHeading title="Users" />
        <Show
          when={
            isAdmin() &&
            tab() !== 'invitations' &&
            (tab() !== 'users' ||
              (!provisioning.loading && !provisioning.error && !provisioning()?.enabled))
          }
        >
          <button
            class="workspace-button small"
            onClick={() =>
              tab() !== 'users' ? navigate(path(`/workspace/users/${tab()}/new`)) : openUser()
            }
          >
            {tab() === 'groups' ? 'Add Group' : 'Add User'}
          </button>
        </Show>
      </div>
      <Show
        when={isAdmin()}
        fallback={
          <Show when={!access.loading && !!access()}>
            <ToastMessage tone="error">Administrator access is required.</ToastMessage>
          </Show>
        }
      >
        <Show when={members.error}>
          <ToastMessage tone="error">{members.error.message}</ToastMessage>
        </Show>
        <div class="list-toolbar">
          <label class="workspace-search" hidden={isListEmpty()}>
            <Icon name="search" />
            <span class="sr-only">Search users</span>
            <input
              type="search"
              maxlength="200"
              placeholder={`Search ${tab()}…`}
              aria-label={`Search ${tab()}`}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div
            class="inbox-status-filters"
            role="tablist"
            aria-label="User sections"
            onKeyDown={tabKey}
          >
            <For each={['users', 'groups', 'invitations']}>
              {(value) => (
                <button
                  type="button"
                  class="inbox-filter-button"
                  id={`users-tab-${value}`}
                  role="tab"
                  aria-selected={tab() === value}
                  aria-controls="users-panel"
                  tabindex={tab() === value ? 0 : -1}
                  onClick={() => switchTab(value)}
                >
                  {value === 'users'
                    ? 'Users'
                    : value === 'queues'
                      ? 'Queues'
                      : value === 'groups'
                        ? 'Groups'
                        : 'Invitations'}
                </button>
              )}
            </For>
          </div>
        </div>
        <section role="tabpanel" id="users-panel" aria-labelledby={`users-tab-${tab()}`}>
          <Show
            when={tab() === 'users'}
            fallback={
              <Show
                when={tab() === 'invitations'}
                fallback={<ApprovalGroupList query={query()} onEmptyChange={setIsListEmpty} />}
              >
                <RecordTable
                  label="Invitations"
                  source="/api/helpdesk/invitations"
                  query={query()}
                  columns={[
                    { label: 'Email', render: (item) => item.email },
                    {
                      label: 'Role',
                      render: (item) =>
                        item.role === 'read-only'
                          ? 'Read Only'
                          : item.role[0].toUpperCase() + item.role.slice(1),
                    },
                    {
                      label: 'Status',
                      render: (item) => item.status[0].toUpperCase() + item.status.slice(1),
                    },
                    {
                      label: 'Delivery',
                      render: (item) => item.delivery[0].toUpperCase() + item.delivery.slice(1),
                    },
                    {
                      label: 'Expires',
                      render: (item) => new Date(item.expiresAt).toLocaleDateString(),
                    },
                  ]}
                />
              </Show>
            }
          >
            <RecordTable
              onEmptyChange={setIsListEmpty}
              label="Users"
              onRowClick={openUser}
              emptyAction={
                !provisioning.loading && !provisioning.error && !provisioning()?.enabled
                  ? { label: 'Add User', onClick: () => openUser() }
                  : undefined
              }
              source="/api/helpdesk/members"
              query={query()}
              refreshKey={`${members()
                ?.map((item) => item.version)
                .join(',')}:${profiles()
                ?.map((item) => item.version)
                .join(',')}`}
              rows={[]}
              columns={[
                {
                  label: 'User',
                  sortValue: (member) => member.email,
                  render: (member) => (
                    <button
                      class="record-table-link"
                      onClick={() => openUser(member)}
                      aria-label={`Edit ${member.email}`}
                    >
                      {member.email}
                    </button>
                  ),
                },
                {
                  label: 'Role',
                  sortValue: (member) => member.role,
                  render: (member) =>
                    member.role === 'read-only'
                      ? 'Read Only'
                      : member.role[0].toUpperCase() + member.role.slice(1),
                },
                {
                  label: 'Title',
                  sortValue: (member) => member.title || profileLabel(member.userId, 'title'),
                  render: (member) => member.title || profileLabel(member.userId, 'title') || '—',
                },
                {
                  label: 'Department',
                  sortValue: (member) =>
                    member.department || profileLabel(member.userId, 'department'),
                  render: (member) =>
                    member.department || profileLabel(member.userId, 'department') || '—',
                },
                {
                  label: 'Manager',
                  sortValue: (member) => member.manager || profileLabel(member.userId, 'manager'),
                  render: (member) =>
                    member.manager || profileLabel(member.userId, 'manager') || '—',
                },
                {
                  label: 'Status',
                  sortValue: (member) => (member.active ? 'Active' : 'Disabled'),
                  render: (member) => (
                    <span class="activity-status" data-tone={member.active ? 'positive' : 'muted'}>
                      <span class="activity-status-dot" />
                      {member.active ? 'Active' : 'Disabled'}
                    </span>
                  ),
                },
                {
                  label: 'Assignment Groups',
                  sortValue: (member) => member.queues.join(', '),
                  render: (member) => member.queues.join(', ') || '—',
                },
              ]}
              emptyText={members.loading ? 'Loading users…' : 'No users match this search.'}
            />
            <Show when={isFormOpen()}>
              <WorkspaceModal
                title={selected() ? 'Edit user' : 'Add user'}
                onClose={() => setIsFormOpen(false)}
              >
                <ValidatedForm class="create-form" onSubmit={save}>
                  <Show when={!selected()} fallback={<p>{selected()?.email}</p>}>
                    <label>
                      Email
                      <input
                        name="email"
                        type="email"
                        required
                        maxlength="254"
                        autocomplete="off"
                      />
                    </label>
                  </Show>
                  <label>
                    Role
                    <Dropdown
                      name="role"
                      ariaLabel="Role"
                      value={role()}
                      onChange={(value) => {
                        setRole(value);
                        if (['user', 'read-only'].includes(value)) setQueues([]);
                        if (value === 'read-only') setCanApprove(false);
                      }}
                      options={['admin', 'agent', 'user', 'read-only'].map((value) => ({
                        value,
                        label:
                          value === 'read-only'
                            ? 'Read Only'
                            : value[0].toUpperCase() + value.slice(1),
                      }))}
                    />
                  </label>
                  <Show when={['admin', 'agent'].includes(role())}>
                    <MultiSelectLookup
                      name="queues"
                      label="Assignment Groups"
                      ariaLabel="Assignment Groups"
                      options={queueOptions()}
                      value={queues()}
                      onChange={setQueues}
                    />
                  </Show>
                  <div class="preference-row">
                    <span>Active</span>
                    <button
                      class="toggle-switch"
                      type="button"
                      role="switch"
                      aria-label="Active user"
                      aria-checked={active()}
                      onClick={() => setActive(!active())}
                    >
                      <span />
                    </button>
                  </div>

                  <div class="preference-row">
                    <span>Approval permission</span>
                    <button
                      class="toggle-switch"
                      type="button"
                      role="switch"
                      aria-label="Approval permission"
                      aria-checked={canApprove()}
                      onClick={() => setCanApprove(!canApprove())}
                    >
                      <span />
                    </button>
                  </div>

                  <div class="helpdesk-actions">
                    <button class="workspace-button" disabled={saving()}>
                      {saving() ? 'Saving…' : 'Save user'}
                    </button>
                    <button
                      class="workspace-button secondary"
                      type="button"
                      onClick={() => setIsFormOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                  <Show when={error()}>
                    <ToastMessage tone="error">{error()}</ToastMessage>
                  </Show>
                </ValidatedForm>
                <Show when={selected()}>
                  <WorkforceProfile userId={selected().userId} onSaved={refreshProfiles} />
                </Show>
              </WorkspaceModal>
            </Show>
            <Show when={error() && !isFormOpen()}>
              <ToastMessage tone="error">{error()}</ToastMessage>
            </Show>
            <Show when={message()}>
              <ToastMessage tone="success" message={message()} />
            </Show>

            <Show when={provisioning.error}>
              <ToastMessage tone="error">{provisioning.error.message}</ToastMessage>
            </Show>
            <Show when={!provisioning.error && provisioning()?.enabled ? provisioning() : null}>
              {(config) => (
                <>
                  <Show when={config().enabled}>
                    <p>
                      New employees receive the User role. SCIM provisioning imports users assigned
                      to this app; verified SSO sign-in can create their account automatically.
                    </p>
                    <label>
                      SCIM URL
                      <input readonly value={config().scimUrl} />
                    </label>
                    <p>Token: {config().hasToken ? 'Configured' : 'Not configured'}</p>
                    <Show when={config().canConfigure}>
                      <ValidatedForm
                        onSubmit={async (event) => {
                          event.preventDefault();
                          setError('');
                          try {
                            const result = await api('/api/helpdesk/provisioning/token', {
                              method: 'POST',
                              body: '{}',
                            });
                            setToken(result.token);
                            await refreshProvisioning();
                          } catch (error) {
                            setError(error.message);
                          }
                        }}
                      >
                        <button class="workspace-button small">
                          {config().hasToken
                            ? 'Rotate provisioning token'
                            : 'Generate provisioning token'}
                        </button>
                      </ValidatedForm>
                    </Show>
                    <Show when={token()}>
                      <label>
                        Provisioning token
                        <input type="password" readonly value={token()} />
                        <span>
                          Copy this token into your identity provider. It is shown only in this
                          session.
                        </span>
                      </label>
                      <button
                        class="workspace-button secondary small"
                        onClick={() => navigator.clipboard.writeText(token())}
                      >
                        Copy token
                      </button>
                    </Show>
                  </Show>
                </>
              )}
            </Show>
            <Show when={directory.error}>
              <ToastMessage tone="error">{directory.error.message}</ToastMessage>
            </Show>
            <Show when={!directory.error && directory()?.length}>
              <h3>Directory users</h3>
              <RecordTable
                onEmptyChange={setIsListEmpty}
                label="Directory users"
                source="/api/helpdesk/directory-users"
                rows={directory()}
                columns={[
                  {
                    label: 'User',
                    sortValue: (user) => user.displayName || user.userName,
                    render: (user) => user.displayName || user.userName,
                  },
                  { key: 'userName', label: 'Email' },
                  { label: 'Title', render: (user) => user.title || '—' },
                  { label: 'Department', render: (user) => user.department || '—' },
                  { label: 'Manager', render: (user) => user.manager || '—' },
                  {
                    label: 'Status',
                    sortValue: (user) => (user.active ? 'Active' : 'Disabled'),
                    render: (user) => (user.active ? 'Active' : 'Disabled'),
                  },
                  {
                    label: 'Account',
                    sortValue: (user) => (user.userId ? 'Account created' : 'Awaiting sign-in'),
                    render: (user) => (user.userId ? 'Account created' : 'Awaiting sign-in'),
                  },
                ]}
              />
            </Show>
          </Show>
        </section>
      </Show>
    </section>
  );
}
