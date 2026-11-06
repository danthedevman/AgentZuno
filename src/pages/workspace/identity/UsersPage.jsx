import ActionMenu from '../../../components/ActionMenu.jsx';
import ProfileAvatar from '../../../components/identity/ProfileAvatar.jsx';
import { displayLabel } from '../../../utils/displayLabels.js';
import { useToasts } from '../../../context/ToastContext.jsx';
import ApprovalGroupList from '../../../components/requests/ApprovalGroupList.jsx';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import Icon from '../../../components/Icon.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import PageHeading from '../../../components/PageHeading.jsx';
import ValidatedForm from '../../../components/ValidatedForm.jsx';
import { useSession } from '../../../context/SessionContext.jsx';
import { confirmAction } from '../../../services/confirmations.js';

export default function UsersPage() {
  const { notify } = useToasts();
  const { session } = useSession();
  const [pendingAction, setPendingAction] = createSignal('');
  const [invitationRevision, setInvitationRevision] = createSignal(0);
  const [invitationLink, setInvitationLink] = createSignal('');
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
  const [provisioning, { refetch: refreshProvisioning }] = createResource(isAdmin, () =>
    api('/api/helpdesk/provisioning'),
  );
  const [directory] = createResource(isAdmin, () => api('/api/helpdesk/directory-users'));
  function openUser(member = null) {
    if (member) navigate(path(`/workspace/users/${member.userId || member.id}`));
    else if (!provisioning.loading && !provisioning.error && !provisioning()?.enabled)
      navigate(path('/workspace/users/new'));
  }
  createEffect(() => {
    if (
      routeQuery.invite === '1' &&
      !provisioning.loading &&
      !provisioning.error &&
      !provisioning()?.enabled
    ) {
      openUser();
      setRouteQuery({ invite: undefined });
    }
  });
  const [error, setError] = createSignal('');
  const [token, setToken] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [tab, setTab] = createSignal(
    ['users', 'groups', 'invitations'].includes(routeQuery.tab) ? routeQuery.tab : 'users',
  );
  async function invitationAction(item, mode) {
    const removing = mode === 'remove';
    if (
      !(await confirmAction(
        removing
          ? `Remove the invitation for ${item.email}? Its link will stop working.`
          : `Replace the invitation for ${item.email}? The previous link will stop working.`,
        removing
          ? 'Remove Invitation'
          : mode === 'email'
            ? 'Resend Invitation'
            : 'Generate New Link',
        removing ? 'Remove Invitation' : mode === 'email' ? 'Resend Email' : 'Generate Link',
      ))
    )
      return;
    setPendingAction(item.id);
    try {
      const result = await api(`/api/helpdesk/invitations/${item.id}${removing ? '' : '/resend'}`, {
        method: removing ? 'DELETE' : 'POST',
        confirmed: true,
        body: JSON.stringify(
          removing ? { confirmed: true, version: item.version } : { mode, version: item.version },
        ),
      });
      setInvitationLink(result.invitationUrl || '');
      setInvitationRevision((value) => value + 1);
      notify({
        tone: 'success',
        message: removing
          ? 'Invitation removed.'
          : mode === 'email'
            ? 'Invitation queued for email delivery.'
            : 'New invitation link ready to copy.',
      });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setPendingAction('');
    }
  }
  async function removeUser(event, member) {
    event?.stopPropagation();
    if (
      !(await confirmAction(
        `Remove ${member.name || member.email} from this workspace? Their account and audit history are retained.`,
        'Remove User',
        'Remove User',
      ))
    )
      return;
    setPendingAction(member.userId);
    try {
      await api(`/api/helpdesk/members/${member.userId}`, {
        method: 'DELETE',
        confirmed: true,
        body: JSON.stringify({ confirmed: true, version: member.version }),
      });
      await refetch();
      notify({ tone: 'success', message: 'User removed from workspace.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setPendingAction('');
    }
  }
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
        <Show when={invitationLink()}>
          <section class="invitation-share-link">
            <label>
              Invitation Link
              <input
                readonly
                value={invitationLink()}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <button
              type="button"
              class="workspace-button secondary small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invitationLink());
                  notify({ tone: 'success', message: 'Invitation link copied.' });
                } catch {
                  notify({
                    tone: 'error',
                    message: 'Could not copy the link. Select it and copy it manually.',
                  });
                }
              }}
            >
              Copy Invitation Link
            </button>
          </section>
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
                  refreshKey={invitationRevision()}
                  query={query()}
                  columns={[
                    { label: 'Email', render: (item) => item.email },
                    {
                      label: 'Role',
                      render: (item) => displayLabel(item.role),
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
                    {
                      label: 'Actions',
                      sortable: false,
                      render: (item) => (
                        <Show
                          when={
                            item.status === 'pending' &&
                            item.delivery !== 'sending' &&
                            !provisioning.loading &&
                            !provisioning.error &&
                            !provisioning()?.enabled
                          }
                        >
                          <div class="helpdesk-actions">
                            <button
                              class="workspace-button secondary small"
                              disabled={!!pendingAction()}
                              onClick={() => invitationAction(item, 'link')}
                            >
                              Generate New Link
                            </button>
                            <Show when={item.canEmail}>
                              <button
                                class="workspace-button secondary small"
                                disabled={!!pendingAction()}
                                onClick={() => invitationAction(item, 'email')}
                              >
                                Resend Email
                              </button>
                            </Show>
                            <button
                              class="workspace-button secondary small"
                              disabled={!!pendingAction()}
                              onClick={() => invitationAction(item, 'remove')}
                            >
                              Remove Invitation
                            </button>
                          </div>
                        </Show>
                      ),
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
                      <span class="record-person-cell">
                        <ProfileAvatar userId={member.userId} name={member.name || member.email} />
                        <span>
                          {member.name || member.email}
                          <Show when={member.name}>
                            <small>{member.email}</small>
                          </Show>
                        </span>
                      </span>
                    </button>
                  ),
                },
                {
                  label: 'Role',
                  sortValue: (member) => member.role,
                  render: (member) => displayLabel(member.role),
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
                {
                  label: 'Actions',
                  sortable: false,
                  render: (member) => (
                    <Show
                      when={
                        !provisioning.loading &&
                        !provisioning.error &&
                        !provisioning()?.enabled &&
                        member.userId !== session()?.user?.id &&
                        member.userId !== access()?.ownerId
                      }
                    >
                      <ActionMenu
                        label={`Actions for ${member.email}`}
                        disabled={!!pendingAction()}
                        items={[{ label: 'Remove User', onClick: () => removeUser(null, member) }]}
                      />
                    </Show>
                  ),
                },
              ]}
              emptyText={members.loading ? 'Loading users…' : 'No users match this search.'}
            />
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
