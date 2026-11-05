import TeamsBotSettings from '../../components/TeamsBotSettings.jsx';
import Toggle from '../../components/Toggle.jsx';
import ConnectorActionsForm from '../../components/ConnectorActionsForm.jsx';
import BackLink from '../../components/BackLink.jsx';
import ConnectorSetupInstructions from '../../components/ConnectorSetupInstructions.jsx';
import ConnectorApplicationForm from '../../components/ConnectorApplicationForm.jsx';
import SlackBotSettings from '../../components/SlackBotSettings.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import Icon from '../../components/Icon.jsx';
import { displayLabel } from '../../services/displayLabels.js';
import ToastMessage from '../../components/ToastMessage.jsx';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import Dropdown from '../../components/Dropdown.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import A from '../../components/WorkspaceLink.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useParams, useNavigate } from '@solidjs/router';
import { api } from '../../services/api.js';

function SupportInboxSettings(props) {
  const [enabled, setEnabled] = createSignal(false);
  const [autoReply, setAutoReply] = createSignal(false);
  const [department, setDepartment] = createSignal('it');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  createEffect(() => {
    setEnabled(props.channel.email.enabled);
    setAutoReply(props.channel.email.autoReply);
    setDepartment(props.channel.email.department);
  });
  return (
    <ValidatedForm
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          await api(`/api/helpdesk/channels/${props.channel.id}/inbox`, {
            method: 'PUT',
            body: JSON.stringify({
              enabled: enabled(),
              autoReply: autoReply(),
              department: department(),
            }),
          });
          await props.onSaved();
        } catch (error) {
          setError(error.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>{props.channel.mailbox}</p>
      <Toggle
        label="Enable Zuno for this support inbox"
        checked={enabled()}
        onChange={setEnabled}
      />
      <Toggle
        label="Automatically reply to incoming requests"
        checked={autoReply()}
        onChange={setAutoReply}
      />
      <Dropdown
        name="department"
        label="Department"
        value={department()}
        onChange={setDepartment}
        options={['it', 'hr', 'legal', 'finance', 'facilities', 'general'].map((value) => ({
          value,
          label: value === 'it' ? 'IT' : value.charAt(0).toUpperCase() + value.slice(1),
        }))}
      />
      <p>
        When automatic replies are off, Zuno saves responses on requests for the support team to
        review. New messages received after activation are checked every minute. Use a dedicated
        support mailbox.
      </p>
      <Show when={props.channel.email.error}>
        <ToastMessage tone="error">{props.channel.email.error}</ToastMessage>
      </Show>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
      <button class="workspace-button small" disabled={busy()}>
        {busy() ? 'Saving…' : 'Save inbox settings'}
      </button>
    </ValidatedForm>
  );
}

export default function ConnectorsPage() {
  const { access } = useWorkspace();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const params = useParams();
  const isAdmin = () => !access?.error && access?.()?.role === 'admin';
  const [channels, { refetch }] = createResource(isAdmin, () => api('/api/helpdesk/channels'));
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal('');
  const selectedChannel = () =>
    !channels.error && channels()?.find((channel) => channel.id === params.provider);
  async function connect(provider) {
    setError('');
    setBusy(provider);
    try {
      const result = await api('/api/helpdesk/channels/oauth/start', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      });
      window.location.assign(result.url);
    } catch (error) {
      setError(error.message);
      setBusy('');
    }
  }
  return (
    <section class="reading-page helpdesk-page">
      <Show when={params.provider}>
        <BackLink href="/workspace/connectors">Connectors</BackLink>
      </Show>
      <div class="connections-heading" data-list-actions>
        <PageHeading
          title={params.provider ? selectedChannel()?.name || 'Connector' : 'Connectors'}
        />
      </div>
      <Show
        when={isAdmin()}
        fallback={
          <Show when={!access.loading && !!access()}>
            <ToastMessage tone="error">Administrator access is required.</ToastMessage>
          </Show>
        }
      >
        <Show when={channels.error}>
          <ToastMessage tone="error">{channels.error.message}</ToastMessage>
        </Show>
        <Show when={!params.provider}>
          <RecordTable
            label="Connectors"
            source="/api/helpdesk/channels"
            refreshKey={JSON.stringify(channels())}
            rows={!channels.error ? channels() || [] : []}
            defaultSort={{ key: 'Connector', direction: 'asc' }}
            onRowClick={(channel) => navigate(path(`/workspace/connectors/${channel.id}`))}
            columns={[
              {
                label: 'Connector',
                sortValue: (channel) => channel.name,
                render: (channel) => (
                  <button
                    class="record-table-link article-table-title"
                    onClick={() => navigate(path(`/workspace/connectors/${channel.id}`))}
                  >
                    <span class="activity-type-badge" data-type="article">
                      <Icon name={channel.purpose === 'support-inbox' ? 'inbox' : 'plug'} />
                    </span>
                    <span>
                      <strong>{channel.name}</strong>
                    </span>
                  </button>
                ),
              },
              {
                label: 'Status',
                sortValue: (channel) => displayLabel(channel.status),
                render: (channel) => (
                  <span
                    class="activity-status"
                    data-tone={!channel.connected ? 'muted' : 'positive'}
                  >
                    <span class="activity-status-dot" />
                    {displayLabel(channel.status)}
                  </span>
                ),
              },
              {
                label: 'Setup',
                sortValue: (channel) => (channel.configured ? 'Configured' : 'Setup Required'),
                render: (channel) => (channel.configured ? 'Configured' : 'Setup Required'),
              },
              {
                label: 'Delivery',
                sortValue: (channel) => displayLabel(channel.deliveryStatus),
                render: (channel) => displayLabel(channel.deliveryStatus),
              },
            ]}
            emptyText={channels.loading ? 'Loading connectors…' : 'No connectors available.'}
          />
        </Show>
        <Show when={params.provider && channels.loading}>
          <Skeleton label="Loading connector" lines={7} />
        </Show>
        <Show when={params.provider && !channels.loading && !channels.error && !selectedChannel()}>
          <p>Connector unavailable.</p>
        </Show>
        <Show when={selectedChannel()}>
          {(selected) => (
            <div class="connector-config-page">
              <For each={[selected()]}>
                {(channel) => (
                  <div class="connector-details">
                    <div>
                      <h2>
                        {channel.name}
                        {channel.purpose === 'support-inbox' ? ' support inbox' : ''}
                      </h2>
                      <p>{channel.description}</p>
                      <p>
                        {displayLabel(channel.status)}
                        {!channel.configured ? ' · Setup required' : ''}
                      </p>
                      <p>Message delivery: {channel.deliveryStatus.toLowerCase()}</p>
                      <ConnectorSetupInstructions provider={channel.id} />
                      <ConnectorApplicationForm channel={channel} onSaved={refetch} />
                      <ConnectorActionsForm channel={channel} onSaved={refetch} />
                      <Show when={channel.id === 'teams'}>
                        <TeamsBotSettings channel={channel} onSaved={refetch} />
                      </Show>
                      <Show when={channel.id !== 'teams'}>
                        <label>
                          OAuth Callback
                          <input readonly value={channel.callbackUrl} />
                        </label>
                      </Show>
                      <Show when={channel.id === 'slack'}>
                        <button
                          type="button"
                          class="workspace-button secondary small"
                          onClick={async () => {
                            try {
                              const manifest = await api('/api/helpdesk/channels/slack/manifest');
                              await navigator.clipboard.writeText(
                                JSON.stringify(manifest, null, 2),
                              );
                            } catch (error) {
                              setError(error.message);
                            }
                          }}
                        >
                          Copy Slack App Manifest
                        </button>
                        <label>
                          Slack Events URL
                          <input readonly value={channel.setup?.eventsUrl} />
                        </label>
                        <p>
                          In Slack app settings, enable a bot user and Events API subscriptions for
                          app_mention, message.channels, message.groups and message.im. Use the
                          Events URL above on a public HTTPS origin, and add the OAuth callback as a
                          redirect URL.
                        </p>
                        <Show
                          when={
                            channel.bot && channel.connected && !channel.bot.requiresReauthorization
                          }
                        >
                          <SlackBotSettings channel={channel} onSaved={refetch} />
                        </Show>
                        <Show when={channel.bot?.requiresReauthorization}>
                          <p>Reinstall the Slack app to authorize the bot permissions.</p>
                        </Show>
                        <Show when={channel.bot?.error}>
                          <ToastMessage tone="error">{channel.bot.error}</ToastMessage>
                        </Show>
                      </Show>

                      <Show
                        when={
                          channel.email && channel.mailbox && !channel.email.requiresReauthorization
                        }
                      >
                        <SupportInboxSettings channel={channel} onSaved={refetch} />
                      </Show>
                      <Show when={channel.email?.requiresReauthorization}>
                        <p>Reauthorize this mailbox to allow Zuno to read requests and reply.</p>
                      </Show>
                    </div>
                    <div class="helpdesk-actions">
                      <Show when={channel.id !== 'teams'}>
                        <ValidatedForm
                          onSubmit={(event) => {
                            event.preventDefault();
                            connect(channel.id);
                          }}
                        >
                          <button
                            class="workspace-button small"
                            disabled={!channel.configured || !!busy()}
                          >
                            {busy() === channel.id
                              ? 'Connecting…'
                              : !channel.connected
                                ? channel.id === 'slack'
                                  ? 'Add to Slack'
                                  : 'Connect'
                                : 'Reauthorize'}
                          </button>
                        </ValidatedForm>
                      </Show>
                      <Show when={channel.connected && channel.id !== 'teams'}>
                        <ValidatedForm
                          onSubmit={async (event) => {
                            event.preventDefault();
                            setError('');
                            try {
                              await api(`/api/helpdesk/channels/${channel.id}/disconnect`, {
                                method: 'POST',
                                body: '{}',
                              });
                              await refetch();
                            } catch (error) {
                              setError(error.message);
                            }
                          }}
                        >
                          <button class="workspace-button secondary small">Disconnect</button>
                        </ValidatedForm>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
        <Show when={error()}>
          <ToastMessage tone="error">{error()}</ToastMessage>
        </Show>
      </Show>
    </section>
  );
}
