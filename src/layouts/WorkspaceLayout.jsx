import { Portal } from 'solid-js/web';
import { publicAsset } from '../services/publicAsset.js';
import { confirmAction } from '../services/confirmations.js';
import AIProviderBanner from '../components/AIProviderBanner.jsx';
import ProfileAvatar from '../components/ProfileAvatar.jsx';
import ChatPrompt from '../components/ChatPrompt.jsx';
import Skeleton from '../components/Skeleton.jsx';
import ToastMessage from '../components/ToastMessage.jsx';
import { getRolePreview, setRolePreview } from '../services/rolePreview.js';
import { api } from '../services/api.js';
import A from '../components/WorkspaceLink.jsx';
import { useLocation, useNavigate, useParams } from '@solidjs/router';
import {
  For,
  Show,
  createSignal,
  createEffect,
  createResource,
  onMount,
  onCleanup,
} from 'solid-js';
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import Icon from '../components/Icon.jsx';
import Dropdown from '../components/Dropdown.jsx';
import { workspacePath } from '../services/workspaceRoutes.js';
import CreatePicker from '../components/CreatePicker.jsx';
import SearchOverlay from '../components/SearchOverlay.jsx';
import { openDialog } from '../services/dialogs.js';

const navigation = [
  ['/workspace/my-work', 'work', 'My Work'],
  ['/workspace/chat', 'chat', 'Chat'],
  ['/workspace/inbox', 'inbox', 'Inbox'],
  ['/workspace/catalog', 'catalog', 'Catalog'],
  ['/workspace/requests', 'request', 'My Requests'],
  ['/workspace/workflows', 'workflow', 'Workflows'],
  ['/workspace/data', 'data', 'Data Tables'],
  ['/workspace/knowledge', 'book-pen', 'Knowledge'],
  ['/workspace/reports', 'reports', 'Reports'],
  ['/workspace/connectors', 'plug', 'Connectors'],
];

function WorkspaceShell(props) {
  const [isNarrow, setIsNarrow] = createSignal(window.matchMedia('(max-width: 700px)').matches);
  const [isNavigationExpanded, setIsNavigationExpanded] = createSignal(
    (() => {
      try {
        if (window.matchMedia('(max-width: 700px)').matches) return false;
        const saved = localStorage.getItem('agentzuno-sidebar-expanded');
        return saved === null ? !window.matchMedia('(max-width: 700px)').matches : saved === 'true';
      } catch {
        return true;
      }
    })(),
  );
  function toggleNavigation() {
    const next = !isNavigationExpanded();
    setIsNavigationExpanded(next);
    try {
      localStorage.setItem('agentzuno-sidebar-expanded', String(next));
    } catch {}
  }
  onMount(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => {
      setIsNarrow(query.matches);
      if (query.matches) setIsNavigationExpanded(false);
    };
    query.addEventListener('change', update);
    const escape = (event) => {
      if (event.key === 'Escape' && query.matches && isNavigationExpanded()) {
        setIsNavigationExpanded(false);
        document.querySelector('.rail-drawer-toggle')?.focus();
      }
    };
    document.addEventListener('keydown', escape);
    onCleanup(() => document.removeEventListener('keydown', escape));
    onCleanup(() => query.removeEventListener('change', update));
  });

  const [sidebarTooltip, setSidebarTooltip] = createSignal(null);
  function showSidebarTooltip(event) {
    if (isNavigationExpanded() || event.pointerType === 'touch') return;
    const anchor = event.target.closest('.rail-link');
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const sidebar = anchor.closest('.workspace-sidebar').getBoundingClientRect();
    setSidebarTooltip({
      label:
        anchor.querySelector('.rail-tooltip')?.textContent.trim() ||
        anchor.getAttribute('aria-label'),
      left: sidebar.right + 8,
      top: Math.max(24, Math.min(window.innerHeight - 24, rect.top + rect.height / 2)),
    });
  }
  function hideSidebarTooltip(event) {
    const anchor = event?.target?.closest?.('.rail-link');
    if (anchor && event.relatedTarget && anchor.contains(event.relatedTarget)) return;
    setSidebarTooltip(null);
  }
  createEffect(() => {
    if (isNavigationExpanded()) setSidebarTooltip(null);
  });
  let createDialog;
  let searchDialog;
  const [activeDialog, setActiveDialog] = createSignal(null);
  function showOverlay(dialog) {
    setActiveDialog(dialog);
    openDialog(dialog);
  }
  function closeOverlay(dialog) {
    if (activeDialog() === dialog) setActiveDialog(null);
  }
  const { session, signOut } = useSession();
  const { workspace, access } = useWorkspace();
  const params = useParams();
  const recentLocation = useLocation();
  let lastViewedPath = '';
  createEffect(() => {
    const pathname = recentLocation.pathname;
    if (!session()?.user || access.loading || pathname === lastViewedPath) return;
    lastViewedPath = pathname;
    api('/api/helpdesk/recent-views', {
      method: 'POST',
      body: JSON.stringify({ href: pathname }),
    }).catch(() => {});
  });
  const isAdmin = () => !access?.error && access?.()?.role === 'admin';
  const isPersonal = () =>
    !params.workspaceId || params.workspaceId === session()?.user?.workspaceId;
  const [memberships] = createResource(
    () => !!session()?.user && !session().user.isDemo,
    () => api('/api/helpdesk/workspaces'),
  );
  const route = useLocation();
  const [inboxState, { refetch: refreshInbox, mutate: setInboxState }] = createResource(
    () => !access.error && access() && `${params.workspaceId}:${access().role}`,
    () => api('/api/helpdesk/inbox/unread'),
  );
  let markingInbox = false;
  const inboxScope = () => `${params.workspaceId}:${!access.error && access()?.role}`;
  async function markInboxViewed() {
    setInboxState((value) => ({ ...value, unread: false }));
    if (markingInbox) return;
    markingInbox = true;
    const currentScope = inboxScope();
    try {
      await api('/api/helpdesk/inbox/viewed', { method: 'POST', body: '{}' });
      await refreshInbox();
      if (currentScope === inboxScope()) setInboxState((value) => ({ ...value, unread: false }));
    } finally {
      markingInbox = false;
    }
  }
  async function updateInbox() {
    if (document.visibilityState !== 'visible') return;
    if (route.pathname.endsWith('/inbox')) await markInboxViewed();
    else await refreshInbox();
  }
  createEffect(() => {
    if (!access.error && access()) {
      const timer = setInterval(() => updateInbox().catch(() => {}), 30000);
      onCleanup(() => clearInterval(timer));
    }
  });
  createEffect(() => {
    if (route.pathname.endsWith('/inbox') && !access.error && access())
      markInboxViewed().catch(() => {});
  });
  const visibleNavigation = () =>
    navigation.filter(([path]) => {
      if (path.endsWith('/my-work'))
        return !access.error && ['admin', 'agent'].includes(access()?.role);
      if (
        path.endsWith('/catalog') ||
        path.endsWith('/requests') ||
        path.endsWith('/chat') ||
        path.endsWith('/knowledge')
      )
        return true;
      if (path === '/workspace/inbox')
        return (
          !access.error &&
          (['admin', 'agent', 'read-only'].includes(access()?.role) ||
            access()?.canApprove ||
            (!inboxState.error && inboxState()?.hasMentions))
        );
      if (
        path.endsWith('/reports') ||
        path.endsWith('/workflows') ||
        path.endsWith('/connectors') ||
        path.endsWith('/data')
      )
        return (
          isAdmin() ||
          (path.endsWith('/reports') && ['read-only', 'agent'].includes(access()?.role))
        );
      return isPersonal() && (!session()?.user || session().user.isDemo || isAdmin());
    });
  const location = useLocation();
  createEffect(() => {
    location.pathname;
    if (isNarrow()) setIsNavigationExpanded(false);
  });
  const isConnections = () => location.pathname.endsWith('/integrations');
  const navigate = useNavigate();
  const [theme, setTheme] = createSignal(
    (() => {
      try {
        return localStorage.getItem('agentzuno-theme') === 'light' ? 'light' : 'dark';
      } catch {
        return 'dark';
      }
    })(),
  );
  function toggleTheme() {
    const nextTheme = theme() === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    try {
      localStorage.setItem('agentzuno-theme', nextTheme);
    } catch {}
  }
  const [error, setError] = createSignal('');
  createEffect(() => {
    location.pathname;
    document.title = 'AgentZuno · Workspace';
    if (
      createDialog &&
      session()?.user &&
      new URLSearchParams(location.search).get('create') === '1'
    ) {
      navigate(location.pathname, { replace: true });
      showOverlay(createDialog);
    }
  });
  async function handleSignOut() {
    if (session()?.user?.isInteractiveDemo) {
      navigate('/');
      return;
    }
    try {
      await signOut();
      navigate('/workspace');
    } catch (error) {
      setError(error.message);
    }
  }
  return (
    <div
      class="workspace-shell"
      classList={{ 'is-nav-expanded': isNavigationExpanded() }}
      data-theme={theme()}
    >
      <Show when={sidebarTooltip()}>
        {(item) => (
          <Portal>
            <span
              class="sidebar-floating-tooltip"
              role="tooltip"
              data-theme={theme()}
              style={{ left: `${item().left}px`, top: `${item().top}px` }}
            >
              {item().label}
            </span>
          </Portal>
        )}
      </Show>
      <a class="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside
        class="workspace-sidebar"
        aria-label="Workspace sidebar"
        onPointerOver={showSidebarTooltip}
        onPointerOut={hideSidebarTooltip}
        onFocusIn={showSidebarTooltip}
        onFocusOut={hideSidebarTooltip}
        onClick={() => setSidebarTooltip(null)}
      >
        <div class="rail-actions">
          <div class="sidebar-brand-row">
            <A class="sidebar-wordmark" href="/workspace" aria-label="AgentZuno home">
              <img
                src={
                  theme() === 'light' ? '/agentzuno-wordmark-light.svg' : '/agentzuno-wordmark.svg'
                }
                alt="AgentZuno"
                width="104"
                height="26"
              />
            </A>
            <button
              type="button"
              class="rail-link rail-drawer-toggle"
              aria-label={isNavigationExpanded() ? 'Collapse navigation' : 'Expand navigation'}
              aria-expanded={isNavigationExpanded()}
              aria-controls="workspace-navigation"
              onClick={toggleNavigation}
            >
              <img
                class="sidebar-brand-mark"
                src={publicAsset('/agentzuno-mark.svg')}
                width="28"
                height="28"
                alt=""
              />
              <Icon name="drawer" />
              <span class="rail-tooltip" aria-hidden="true">
                Menu
              </span>
            </button>
            <Show when={isNavigationExpanded()}>
              <button
                class="rail-link rail-search"
                aria-label="Search"
                aria-haspopup="dialog"
                onClick={() => showOverlay(searchDialog)}
              >
                <Icon name="search" />
                <span class="rail-tooltip" aria-hidden="true">
                  Search
                </span>
              </button>
            </Show>
          </div>
          <button
            class="rail-link rail-create"
            aria-label="Create new item"
            aria-haspopup="dialog"
            onClick={() =>
              session()?.user ? showOverlay(createDialog) : navigate('/login?next=create')
            }
          >
            <Icon name="plus" />
            <span class="rail-tooltip" aria-hidden="true">
              Create
            </span>
          </button>
          <Show when={!isNavigationExpanded()}>
            <button
              class="rail-link rail-search"
              aria-label="Search"
              aria-haspopup="dialog"
              onClick={() => showOverlay(searchDialog)}
            >
              <Icon name="search" />
              <span class="rail-tooltip" aria-hidden="true">
                Search
              </span>
            </button>
          </Show>
        </div>
        <div class="rail-separator" aria-hidden="true" />
        <nav
          id="workspace-navigation"
          aria-label="Workspace navigation"
          onScroll={() => setSidebarTooltip(null)}
        >
          <For each={visibleNavigation()}>
            {([path, icon, label]) => (
              <A
                class="rail-link"
                href={path}
                end={path === '/workspace'}
                activeClass="is-active"
                onClick={() => {
                  activeDialog()?.close();
                  if (isNarrow()) setIsNavigationExpanded(false);
                }}
                aria-label={label}
              >
                <Icon name={icon} />
                <Show
                  when={
                    path === '/workspace/inbox' &&
                    !route.pathname.endsWith('/inbox') &&
                    !inboxState.error &&
                    inboxState()?.unread
                  }
                >
                  <span class="inbox-unread-dot" role="img" aria-label="Unread inbox items" />
                </Show>
                <span class="rail-tooltip" aria-hidden="true">
                  {label}
                </span>
              </A>
            )}
          </For>
        </nav>
        <div class="sidebar-bottom">
          <button
            class="profile-trigger rail-link"
            popovertarget="profile-popover"
            aria-label="Open profile menu"
            onClick={() => activeDialog()?.close()}
          >
            <Show when={session()?.user} fallback={<Icon name="user" />}>
              <ProfileAvatar
                userId={session()?.user?.id}
                name={session()?.user?.name}
                refreshKey={session()?.user?.profilePictureVersion}
              />
            </Show>
            <span class="rail-tooltip" aria-hidden="true">
              {isNavigationExpanded() ? session()?.user?.name || 'Profile' : 'Profile'}
            </span>
          </button>
          <div id="profile-popover" class="profile-popover" popover="auto">
            <Show when={!access.error && access()?.canImpersonate}>
              <label class="profile-workspace profile-impersonate">
                Impersonate
                <Dropdown
                  ariaLabel="Impersonate"
                  value={access()?.role}
                  options={['admin', 'agent', 'user', 'read-only'].map((value) => ({
                    value,
                    label:
                      value === 'read-only' ? 'Read Only' : value[0].toUpperCase() + value.slice(1),
                  }))}
                  onChange={async (role) => {
                    document.getElementById('profile-popover').hidePopover();
                    try {
                      await setRolePreview(params.workspaceId, role);
                    } catch (error) {
                      setError(error.message);
                      return;
                    }
                    navigate(workspacePath('/workspace/chat', params.workspaceId));
                  }}
                />
              </label>
            </Show>
            <A
              href="/docs"
              onClick={() => document.getElementById('profile-popover').hidePopover()}
            >
              <Icon name="book" /> Docs
            </A>

            <A
              href="/workspace/profile"
              onClick={() => document.getElementById('profile-popover').hidePopover()}
            >
              <Icon name="profile" />
              Profile
            </A>
            <Show when={isAdmin()}>
              <A
                href="/workspace/users"
                onClick={() => document.getElementById('profile-popover').hidePopover()}
              >
                <Icon name="users" />
                Users
              </A>
            </Show>
            <Show when={isPersonal() && isAdmin()}>
              <A
                href="/workspace/settings"
                onClick={() => document.getElementById('profile-popover').hidePopover()}
              >
                <Icon name="settings" />
                Settings
              </A>
            </Show>
            <Show when={memberships()?.length > 1}>
              <label class="profile-workspace">
                Workspace
                <Dropdown
                  ariaLabel="Workspace"
                  value={params.workspaceId || session()?.user?.workspaceId}
                  options={memberships().map((item, index) => ({
                    value: item.workspaceId,
                    label: item.isPersonal ? 'Personal workspace' : `Help desk ${index}`,
                  }))}
                  onChange={(id) => {
                    document.getElementById('profile-popover').hidePopover();
                    navigate(`/workspace/${id}/requests`);
                  }}
                />
              </label>
            </Show>

            <button
              onClick={toggleTheme}
              aria-label={theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-pressed={theme() === 'dark'}
            >
              <Icon name={theme() === 'dark' ? 'sun' : 'moon'} />
              {theme() === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <Show
              when={session()?.user}
              fallback={
                <A href="/login">
                  <Icon name="user" />
                  Sign in
                </A>
              }
            >
              <button
                onClick={() => {
                  document.getElementById('profile-popover').hidePopover();
                  handleSignOut();
                }}
              >
                <Icon name="user" />
                Sign out
              </button>
            </Show>
          </div>
        </div>
      </aside>
      <CreatePicker
        isAdmin={isAdmin()}
        isPersonal={isPersonal()}
        dialogRef={(element) => (createDialog = element)}
        onClose={closeOverlay}
      />
      <SearchOverlay
        active={activeDialog() === searchDialog}
        dialogRef={(element) => (searchDialog = element)}
        onClose={closeOverlay}
      />
      <Show when={activeDialog()}>
        <div
          class="workspace-overlay-backdrop"
          onClick={() => activeDialog()?.close()}
          aria-hidden="true"
        />
      </Show>
      <Show when={isNarrow() && isNavigationExpanded()}>
        <button
          class="sidebar-mobile-backdrop"
          tabindex="-1"
          aria-hidden="true"
          onClick={() => setIsNavigationExpanded(false)}
        />
      </Show>
      <div
        class="workspace-body"
        inert={!!activeDialog() || (isNarrow() && isNavigationExpanded())}
      >
        <Show when={session()?.user?.isInteractiveDemo} fallback={<AIProviderBanner />}>
          <div class="ai-provider-banner interactive-demo-banner">
            <span>Interactive Demo · Fictional Data</span>
            <div>
              <button
                type="button"
                class="workspace-button secondary small"
                onClick={async () => {
                  if (
                    await confirmAction('Reset changes made in this demo?', 'Reset Demo', 'Reset')
                  ) {
                    await api('/api/demo/reset', { method: 'POST', body: '{}' });
                    window.location.assign('/demo');
                  }
                }}
              >
                Reset Demo
              </button>
              <A class="workspace-button small" href="/register">
                Get Access
              </A>
            </div>
          </div>
        </Show>
        <main id="workspace-main" class="workspace-main">
          <Show when={props.previewRole && props.previewRole !== 'admin'}>
            <div class="role-preview-banner" role="status">
              <span>
                Viewing as{' '}
                {props.previewRole === 'user'
                  ? 'User'
                  : props.previewRole === 'read-only'
                    ? 'Read Only'
                    : 'Agent'}
              </span>
              <button
                class="card-link"
                type="button"
                onClick={async () => {
                  try {
                    await setRolePreview(params.workspaceId, 'admin');
                  } catch (error) {
                    setError(error.message);
                  }
                }}
              >
                Return to Admin
              </button>
            </div>
          </Show>
          <Show when={error()}>
            <ToastMessage tone="error">{error()}</ToastMessage>
          </Show>
          <Show when={workspace.error}>
            <div role="alert" class="empty-state">
              <h2>We couldn’t load the workspace.</h2>
              <p>{workspace.error?.message}</p>
              <button onClick={() => window.location.reload()}>Try again</button>
            </div>
          </Show>
          <Show when={!workspace.error}>{props.children}</Show>
        </main>
      </div>
    </div>
  );
}

export default function WorkspaceLayout(props) {
  const { session } = useSession();
  const params = useParams();
  const location = useLocation();
  const isConnections = () => location.pathname.endsWith('/integrations');
  const navigate = useNavigate();
  const [previewRole, setPreviewRole] = createSignal('admin');
  const refreshPreview = () =>
    setPreviewRole(getRolePreview(params.workspaceId || session()?.user?.workspaceId));
  createEffect(refreshPreview);
  window.addEventListener('agentzuno-role-preview', refreshPreview);
  window.addEventListener('storage', refreshPreview);
  window.addEventListener('focus', refreshPreview);
  onCleanup(() => {
    window.removeEventListener('agentzuno-role-preview', refreshPreview);
    window.removeEventListener('storage', refreshPreview);
    window.removeEventListener('focus', refreshPreview);
  });
  const [access, { refetch: refreshAccess }] = createResource(
    () =>
      !session.loading && session()?.user && !session().user.isDemo
        ? `${session().user.id}:${params.workspaceId || session().user.workspaceId}:${previewRole()}`
        : false,
    () =>
      api('/api/helpdesk/access', {
        headers: { 'X-Workspace-Id': params.workspaceId || session().user.workspaceId },
      }),
  );
  createEffect(() => {
    if (!access.error && access())
      setPreviewRole(access().isImpersonating ? access().role : 'admin');
  });
  const canAccess = () =>
    !params.workspaceId ||
    session()?.user?.workspaceId === params.workspaceId ||
    (!access.error && access()?.workspaceId === params.workspaceId);
  createEffect(() => {
    if (session.loading) return;
    if (!session()?.user)
      navigate(
        location.pathname.includes('/chat')
          ? `/login?next=chat${params.workspaceId ? `&workspace=${params.workspaceId}` : ''}${params.id ? `&chat=${encodeURIComponent(params.id)}` : ''}`
          : '/login',
        { replace: true },
      );
    else if (session()?.user?.isInteractiveDemo && location.pathname.replace(/\/$/, '') === '/demo')
      navigate('/demo/my-work', { replace: true });
    else if (
      !access.loading &&
      !access.error &&
      location.pathname.replace(/\/$/, '') === `/workspace/${params.workspaceId}`
    )
      navigate(
        `/workspace/${params.workspaceId}/${['admin', 'agent'].includes(access()?.role) ? 'my-work' : 'chat'}${location.search}`,
        { replace: true },
      );
    else if (session()?.user && !session().user.isInteractiveDemo && !params.workspaceId)
      navigate(
        location.pathname.replace('/workspace', `/workspace/${session().user.workspaceId}`) +
          location.search,
        { replace: true },
      );
  });
  return (
    <Show
      when={!!session()?.user && (!access.loading || canAccess())}
      fallback={
        <div class="workspace-loading-shell">
          <div class="workspace-loading-rail" aria-hidden="true" />
          <main>
            <Show
              when={location.pathname.includes('/chat')}
              fallback={<Skeleton label="Loading workspace" lines={6} />}
            >
              <div class="chat-welcome">
                <h1>
                  <Skeleton label="Loading greeting" lines={1} />
                </h1>
                <ChatPrompt disabled value="" />
                <div class="chat-history">
                  <h2>Recent Chats</h2>
                  <Skeleton label="Loading recent chats" lines={3} />
                </div>
              </div>
            </Show>
          </main>
        </div>
      }
    >
      <Show
        when={canAccess() || (session.loading && isConnections())}
        fallback={
          <main class="login-page">
            <section class="login-panel">
              <h1>Workspace unavailable</h1>
              <p>You do not have access to this workspace.</p>
              <A href="/workspace">Open your workspace</A>
            </section>
          </main>
        }
      >
        <WorkspaceProvider access={access} refreshAccess={refreshAccess}>
          <WorkspaceShell previewRole={previewRole()}>{props.children}</WorkspaceShell>
        </WorkspaceProvider>
      </Show>
    </Show>
  );
}
