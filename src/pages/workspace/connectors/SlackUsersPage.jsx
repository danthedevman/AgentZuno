import { Show, createResource } from 'solid-js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import PageHeading from '../../../components/PageHeading.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import SlackBotSettings from '../../../components/settings/SlackBotSettings.jsx';

export default function SlackUsersPage() {
  const { access } = useWorkspace();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const [channel, { refetch }] = createResource(isAdmin, async () =>
    (await api('/api/helpdesk/channels')).find((item) => item.id === 'slack'),
  );
  return (
    <section class="reading-page helpdesk-page slack-users-page">
      <Breadcrumbs
        items={[
          { label: 'Connectors', href: '/workspace/connectors' },
          { label: 'Slack', href: '/workspace/connectors/slack' },
          { label: 'Users' },
        ]}
      />
      <PageHeading title="Slack Users" />
      <Show when={!access.loading && !channel.loading} fallback={<Skeleton />}>
        <Show
          when={isAdmin()}
          fallback={<ToastMessage tone="error">Administrator access is required.</ToastMessage>}
        >
          <Show
            when={!channel.error}
            fallback={<ToastMessage tone="error">{channel.error?.message}</ToastMessage>}
          >
            <Show
              when={
                channel()?.connected && channel()?.bot && !channel()?.bot?.requiresReauthorization
              }
              fallback={
                <p>
                  Connect Slack before reviewing users.{' '}
                  <A href="/workspace/connectors/slack">Open Slack Settings</A>
                </p>
              }
            >
              <div class="slack-workspace-summary">
                <div>
                  <span>Slack workspace</span>
                  <strong>{channel().bot.teamName || 'Connected workspace'}</strong>
                  <small>{channel().bot.teamId || 'Workspace ID unavailable'}</small>
                </div>
                <div>
                  <span>Linked users</span>
                  <strong>{channel().bot.identityBindings?.length || 0}</strong>
                </div>
              </div>
              <Show when={channel()}>
                {(current) => (
                  <SlackBotSettings channel={current()} manageUsers onSaved={refetch} />
                )}
              </Show>
            </Show>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
