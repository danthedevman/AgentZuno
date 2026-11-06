import TaskListPage from '../requests/TaskListPage.jsx';
import { pollConversation } from '../../../services/chat/conversationPolling.js';
import ReferenceArrow from '../../../components/ReferenceArrow.jsx';
import BackLink from '../../../components/BackLink.jsx';
import { untrack } from 'solid-js';
import {
  confirmAction,
  confirmRemovedFields,
  clearConfirmedFields,
} from '../../../services/confirmations.js';
import DataTableBuilder from '../../../components/data/DataTableBuilder.jsx';
import { Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { api } from '../../../services/api.js';
import { useToasts } from '../../../context/ToastContext.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import PageHeading from '../../../components/PageHeading.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
const emptyDefinition = () => ({
  name: '',
  description: '',
  fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
});
function DataTablePage() {
  const params = useParams();
  const [query, setQuery] = useSearchParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const { access } = useWorkspace();
  const { notify } = useToasts();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const isNew = () => params.id === 'new';
  const designing = () => isNew() || query.design === '1';
  const [tables, { refetch: refreshTables }] = createResource(isAdmin, () =>
    api('/api/helpdesk/data/tables'),
  );
  const [table, { refetch: refreshTable }] = createResource(
    () => (isAdmin() && params.id && !isNew() ? params.id : false),
    (id) => api(`/api/helpdesk/data/tables/${id}`),
  );
  const [draft, setDraft] = createSignal(emptyDefinition());
  createEffect(() => {
    if (!table.error && table())
      setDraft({ name: table().name, description: table().description, fields: table().fields });
  });
  const [prompt, setPrompt] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [scrollRevision, setScrollRevision] = createSignal(0);
  const [revision, setRevision] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const chatId = () => (/^[a-f0-9]{24}$/.test(query.chat || '') ? query.chat : '');
  const [conversation, { refetch: refreshConversation }] = createResource(
    () => isAdmin() && (chatId() || false),
    (id) => api(`/api/helpdesk/data/conversations/${id}`),
  );
  const [messages, setMessages] = createStore([]);
  let previousProposal = '';
  createEffect(() => {
    setMessages(
      reconcile(
        chatId() && conversation()?.id === chatId() && !conversation.error
          ? conversation()?.messages || []
          : [],
        {
          key: 'id',
        },
      ),
    );
    if (
      chatId() &&
      conversation()?.id === chatId() &&
      !conversation.error &&
      conversation()?.definition
    ) {
      const proposal = JSON.stringify(conversation().definition);
      if (proposal !== previousProposal) {
        previousProposal = proposal;
        const next = conversation().definition;
        const before = untrack(() => draft().fields || []);
        confirmRemovedFields(before, next.fields || []).then((approved) => {
          if (approved && proposal === previousProposal && conversation()?.id === chatId())
            setDraft(next);
        });
      }
    }
  });
  const processing = () =>
    !!chatId() &&
    conversation()?.id === chatId() &&
    !conversation.error &&
    ['queued', 'responding'].includes(conversation()?.status);
  pollConversation(() => processing(), refreshConversation);
  async function send(event) {
    event.preventDefault();
    if (sending() || processing() || !prompt().trim()) return;
    setSending(true);
    try {
      const definition =
        draft().name.trim() && draft().fields.every((field) => field.label.trim())
          ? draft()
          : undefined;
      const result = await api(
        chatId()
          ? `/api/helpdesk/data/conversations/${chatId()}/messages`
          : '/api/helpdesk/data/conversations',
        {
          method: 'POST',
          body: JSON.stringify({
            text: prompt().trim(),
            ...(chatId() ? {} : { requestId: crypto.randomUUID() }),
            ...(definition ? { definition } : {}),
          }),
        },
      );
      if (!chatId()) setQuery({ chat: result.id });
      setPrompt('');
      await refreshConversation();
      setScrollRevision((value) => value + 1);
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSending(false);
    }
  }
  async function saveTable(event) {
    event.preventDefault();
    if (!(await confirmRemovedFields(table()?.fields || [], draft()?.fields || []))) return;
    setSaving(true);
    try {
      const result = await api(
        isNew() ? '/api/helpdesk/data/tables' : `/api/helpdesk/data/tables/${params.id}`,
        {
          method: isNew() ? 'POST' : 'PUT',
          body: JSON.stringify({
            confirmedRemovedFieldIds: (table()?.fields || [])
              .filter((field) => !draft().fields.some((item) => item.id === field.id))
              .map((field) => field.id),
            definition: draft(),
            ...(isNew() ? {} : { version: table().version }),
          }),
        },
      );
      clearConfirmedFields();
      await refreshTables();
      notify({
        tone: 'success',
        message: 'Table saved.',
        destination: path(`/workspace/data/${result.id}${chatId() ? `?chat=${chatId()}` : ''}`),
      });
      navigate(path(`/workspace/data/${result.id}${chatId() ? `?chat=${chatId()}` : ''}`));
      await refreshTable();
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  function openRecord(item = null) {
    if (params.id === 'ref-user-access') {
      navigate(path(`/workspace/access/${item?.id || ''}`));
      return;
    }
    if (params.id === 'ref-knowledge-topic') {
      navigate(path(`/workspace/knowledge/topics/${item?.id || 'new'}`));
      return;
    }
    if (params.id === 'ref-task') {
      navigate(path(`/workspace/tasks/${item?.id || 'new'}`));
      return;
    }
    navigate(path(`/workspace/data/${params.id}/records/${item?.id || 'new'}`));
  }
  return (
    <section class={designing() ? 'workflow-page is-builder data-page' : 'reading-page data-page'}>
      <Show
        when={isAdmin()}
        fallback={
          <Show when={!access.loading && !!access()}>
            <ToastMessage tone="error">Administrator access is required.</ToastMessage>
          </Show>
        }
      >
        <Show
          when={!params.id}
          fallback={
            <>
              <Show when={!designing()}>
                <BackLink href="/workspace/data">Data Tables</BackLink>
                <div class="connections-heading">
                  <PageHeading title={isNew() ? 'New Table' : table()?.name || 'Table'} />
                  <Show when={!designing() && table()}>
                    <div class="helpdesk-actions" data-list-actions>
                      <Show when={!table()?.system && !table()?.sourceManaged}>
                        <button
                          class="workspace-button secondary small"
                          onClick={async () => {
                            const value = table();
                            if (
                              !(await confirmAction(
                                `Permanently delete ${value.name} and all of its records?`,
                                'Delete Table',
                                'Delete Table',
                                { requiredText: value.name },
                              ))
                            )
                              return;
                            try {
                              await api(`/api/helpdesk/data/tables/${params.id}`, {
                                method: 'DELETE',
                                confirmed: true,
                                body: JSON.stringify({
                                  confirmed: true,
                                  name: value.name,
                                  version: value.version,
                                }),
                              });
                              navigate(path('/workspace/data'));
                              await refreshTables();
                              notify({ tone: 'success', message: 'Table deleted.' });
                            } catch (error) {
                              notify({ tone: 'error', message: error.message });
                            }
                          }}
                        >
                          Delete Table
                        </button>
                      </Show>
                      <button
                        class="workspace-button secondary small"
                        onClick={() => setQuery({ design: '1' })}
                      >
                        Edit Table
                      </button>
                      <button
                        class="workspace-button small"
                        disabled={
                          table()?.sourceManaged &&
                          !['ref-task', 'ref-knowledge-topic'].includes(params.id)
                        }
                        onClick={() => openRecord()}
                      >
                        {params.id === 'ref-task' ? 'Add Task' : 'Add Record'}
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
              <Show when={table.error}>
                <ToastMessage tone="error">{table.error.message}</ToastMessage>
              </Show>
              <Show
                when={designing()}
                fallback={
                  <Show when={!table.error && table()}>
                    {(value) => (
                      <RecordTable
                        label={`${value().name} Records`}
                        emptyAction={
                          value().sourceManaged &&
                          !['ref-task', 'ref-knowledge-topic'].includes(params.id)
                            ? undefined
                            : { label: 'Add Record', onClick: () => openRecord() }
                        }
                        source={`/api/helpdesk/data/tables/${params.id}/records`}
                        refreshKey={revision()}
                        onRowClick={openRecord}
                        columns={[
                          ...value().fields.map((field) => ({
                            key: field.id,
                            label: field.label,
                            exportValue: (row) =>
                              field.type === 'reference'
                                ? row.labels?.[field.id] || row.values[field.id]
                                : row.values[field.id],
                            render: (row) =>
                              field.type === 'reference' ? (
                                <span class="record-reference-value">
                                  {row.labels[field.id] || '—'}
                                  <ReferenceArrow
                                    href={
                                      row.values[field.id]
                                        ? field.referenceTable === 'users'
                                          ? `/workspace/users/${row.values[field.id]}`
                                          : `/workspace/data/${field.referenceTable}/records/${row.values[field.id]}`
                                        : ''
                                    }
                                    label={field.label}
                                  />
                                </span>
                              ) : typeof row.values[field.id] === 'boolean' ? (
                                row.values[field.id] ? (
                                  'Yes'
                                ) : (
                                  'No'
                                )
                              ) : (
                                String(row.values[field.id] ?? '—')
                              ),
                          })),
                          {
                            label: 'Updated',
                            defaultDirection: 'desc',
                            render: (row) =>
                              row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '—',
                          },
                        ]}
                      />
                    )}
                  </Show>
                }
              >
                <DataTableBuilder
                  scrollRevision={scrollRevision()}
                  value={draft()}
                  onChange={setDraft}
                  tables={tables() || []}
                  protectedFields={!table.error ? table()?.protectedFields || [] : []}
                  isNew={isNew()}
                  tableId={params.id}
                  saving={saving()}
                  onSave={saveTable}
                  prompt={prompt()}
                  onPrompt={setPrompt}
                  onSend={send}
                  onNewConversation={() => {
                    setQuery({ chat: undefined });
                    setPrompt('');
                    setMessages([]);
                    previousProposal = '';
                  }}
                  sending={sending()}
                  processing={processing()}
                  failed={!conversation.error && conversation()?.status === 'failed'}
                  error={conversation.error?.message}
                  loading={
                    !!query.chat && conversation.loading && conversation()?.id !== query.chat
                  }
                  messages={messages}
                />
              </Show>
            </>
          }
        >
          <div class="connections-heading">
            <PageHeading title="Data Tables" />
            <A class="workspace-button small" href="/workspace/data/new">
              New Table
            </A>
          </div>
          <RecordTable
            label="Data Tables"
            emptyAction={{ label: 'Add Table', href: '/workspace/data/new' }}
            source="/api/helpdesk/data/tables"
            defaultSort={{ key: 'Table', direction: 'asc' }}
            columns={[
              {
                label: 'Table',
                render: (item) => (
                  <A class="article-table-title" href={`/workspace/data/${item.id}`}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.system
                          ? item.description === 'IT service desk records'
                            ? 'Built-In Table'
                            : 'Shared Workforce References'
                          : 'Custom Table'}
                      </small>
                    </span>
                  </A>
                ),
              },
              { label: 'Description', render: (item) => item.description },
              { label: 'Fields', render: (item) => item.fields.length },
              {
                label: 'Updated',
                defaultDirection: 'desc',
                render: (item) =>
                  item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '—',
              },
            ]}
          />
        </Show>
      </Show>
    </section>
  );
}

export default function DataPage() {
  const params = useParams();
  return (
    <Show when={params.id === 'ref-task'} fallback={<DataTablePage />}>
      <TaskListPage />
    </Show>
  );
}
