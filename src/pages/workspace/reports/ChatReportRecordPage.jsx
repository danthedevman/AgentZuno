import { For, Show, createResource } from 'solid-js';
import { useParams, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';
import ChatMarkdown from '../../../components/chat/ChatMarkdown.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import { displayLabel } from '../../../utils/displayLabels.js';

export default function ChatReportRecordPage() {
  const params = useParams();
  const [query] = useSearchParams();
  const { access } = useWorkspace();
  const canRead = () => !access.error && access()?.role === 'admin';
  const days = () => (['7', '30', '90'].includes(query.days) ? query.days : '30');
  const [chat] = createResource(
    () => canRead() && params.id,
    (id) => api(`/api/helpdesk/report-chats/${id}`),
  );
  const current = () => (chat.error ? null : chat());
  return (
    <section class="reading-page chat-report-record-page">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/workspace/reports' },
          { label: 'Chat Activity', href: `/workspace/reports?report=chats&days=${days()}` },
          { label: 'Chat Record' },
        ]}
      />
      <RecordHeader title="Chat Record" context={current()?.title} />
      <Show when={!access.loading && !canRead()}>
        <ToastMessage tone="error">Administrator access is required.</ToastMessage>
      </Show>
      <Show when={chat.error}>
        <ToastMessage tone="error">{chat.error.message}</ToastMessage>
      </Show>
      <Show when={chat.loading || access.loading}>
        <Skeleton label="Loading transcript" lines={8} />
      </Show>
      <Show when={current()}>
        {(item) => (
          <>
            <dl class="chat-report-metadata">
              <For
                each={[
                  ['User', item().user],
                  ['Channel', displayLabel(item().channel)],
                  ['Assistant', displayLabel(item().assistant)],
                  ['Status', displayLabel(item().status)],
                  ['Started', item().createdAt ? new Date(item().createdAt).toLocaleString() : '—'],
                  ['Updated', item().updatedAt ? new Date(item().updatedAt).toLocaleString() : '—'],
                ]}
              >
                {([label, value]) => (
                  <div>
                    <dt>{label}</dt>
                    <dd>{value || '—'}</dd>
                  </div>
                )}
              </For>
            </dl>
            <div class="report-transcript" aria-label="Chat transcript">
              <For
                each={item().messages}
                fallback={<p class="field-help">No messages recorded.</p>}
              >
                {(message) => (
                  <article class="report-transcript-message">
                    <strong>{message.role === 'user' ? 'User' : 'Agent'}</strong>
                    <ChatMarkdown text={message.text} />
                    <Show when={message.tools?.length}>
                      <details>
                        <summary>Tools Used ({message.tools.length})</summary>
                        <ul>
                          <For each={message.tools}>
                            {(tool) => (
                              <li>
                                {tool.name} · {tool.status}
                              </li>
                            )}
                          </For>
                        </ul>
                      </details>
                    </Show>
                  </article>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </section>
  );
}
