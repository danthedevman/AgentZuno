import { createResource, createSignal, For, Show } from 'solid-js';
import { api } from '../../services/api.js';
import RecordTable from '../records/RecordTable.jsx';
import WorkspaceModal from '../WorkspaceModal.jsx';
import ChatMarkdown from './ChatMarkdown.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';
export default function ChatReports(props) {
  const [selected, setSelected] = createSignal('');
  const [chat] = createResource(selected, (id) => api(`/api/helpdesk/report-chats/${id}`));
  const current = () => (chat.error ? null : chat());
  return (
    <>
      <RecordTable
        label="Workspace Chats"
        source="/api/helpdesk/report-chats"
        sourceParams={{ days: props.days }}
        refreshKey={props.refreshKey}
        defaultSort={{ key: 'Updated', direction: 'desc' }}
        onRowClick={(row) => setSelected(row.id)}
        columns={[
          { label: 'Chat', render: (row) => row.title },
          { label: 'User', sortable: false, render: (row) => row.user },
          { label: 'Channel', sortable: false, render: (row) => row.channel },
          { label: 'Assistant', sortable: false, render: (row) => row.assistant },
          { label: 'Status', render: (row) => row.status },
          { label: 'Started', render: (row) => new Date(row.createdAt).toLocaleString() },
          { label: 'Updated', render: (row) => new Date(row.updatedAt).toLocaleString() },
        ]}
      />
      <Show when={selected()}>
        <WorkspaceModal title="Chat Transcript" onClose={() => setSelected('')}>
          <Show when={chat.loading}>
            <Skeleton label="Loading transcript" lines={8} />
          </Show>
          <Show when={chat.error}>
            <ToastMessage tone="error">{chat.error.message}</ToastMessage>
          </Show>
          <Show when={current()}>
            {(item) => (
              <section class="report-transcript">
                <h3>{item().title}</h3>
                <For each={item().messages}>
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
              </section>
            )}
          </Show>
        </WorkspaceModal>
      </Show>
    </>
  );
}
