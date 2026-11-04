import WorkspaceModal from '../../components/WorkspaceModal.jsx';
import { displayLabel, statusLabel } from '../../services/displayLabels.js';
import InboxList from '../../components/InboxList.jsx';
import { useToasts } from '../../context/ToastContext.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import Icon from '../../components/Icon.jsx';
import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { useSession } from '../../context/SessionContext.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import A from '../../components/WorkspaceLink.jsx';
import Dropdown from '../../components/Dropdown.jsx';
import { api } from '../../services/api.js';

export default function RequestsPage(props) {
  const [isListEmpty, setIsListEmpty] = createSignal(false);
  const { session } = useSession();
  const [status, setStatus] = createSignal('');
  const [requestQuery, setRequestQuery] = createSignal('');
  const [inboxTab, setInboxTab] = createSignal('primary');
  const [busyIds, setBusyIds] = createSignal([]);
  const [selectedIds, setSelectedIds] = createSignal([]);
  const [processedCount, setProcessedCount] = createSignal(0);
  const [pageRows, setPageRows] = createSignal([]);
  const [revision, setRevision] = createSignal(0);
  const changeInboxTab = (value) => {
    if (busyIds().length) return;
    setSelectedIds([]);
    setInboxTab(value);
  };
  const { notify } = useToasts();
  const [requests, { refetch }] = createResource(
    () =>
      session()?.user && !session().user.isDemo
        ? props.inbox
          ? inboxTab()
          : status() || 'all'
        : false,
    () =>
      api(
        props.inbox
          ? `/api/helpdesk/inbox?tab=${inboxTab()}`
          : `/api/helpdesk/requests${status() ? `?status=${status()}` : ''}`,
      ),
  );
  const visibleRequests = () => pageRows();
  const selectedVisible = () =>
    selectedIds().filter((id) => visibleRequests().some((item) => item.id === id));
  const [pendingArchive, setPendingArchive] = createSignal(null);
  function archiveItems(ids) {
    if (inboxTab() === 'archive') return executeArchive(ids);
    if (!busyIds().length && !requests.loading && ids.length) setPendingArchive([...ids]);
  }
  async function executeArchive(ids) {
    if (busyIds().length || requests.loading || !ids.length) return;
    const archived = inboxTab() !== 'archive';
    setBusyIds(ids);
    setProcessedCount(0);
    const completed = [];
    const failed = [];
    try {
      for (let offset = 0; offset < ids.length; offset += 5) {
        const batch = ids.slice(offset, offset + 5);
        const results = await Promise.allSettled(
          batch.map((id) =>
            api(`/api/helpdesk/inbox/${id}`, { method: 'PUT', body: JSON.stringify({ archived }) }),
          ),
        );
        results.forEach((result, index) =>
          (result.status === 'fulfilled' ? completed : failed).push(batch[index]),
        );
        setProcessedCount(completed.length + failed.length);
      }
      setSelectedIds((items) => items.filter((id) => !completed.includes(id)));
      await refetch();
      setRevision((value) => value + 1);
      if (completed.length)
        notify({
          tone: 'success',
          message: `${completed.length} ${completed.length === 1 ? 'item' : 'items'} ${archived ? 'archived' : 'restored to Primary'}.`,
        });
      if (failed.length)
        notify({
          tone: 'error',
          message: `${failed.length} ${failed.length === 1 ? 'item could' : 'items could'} not be ${archived ? 'archived' : 'restored'}. Please retry.`,
        });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusyIds([]);
    }
  }
  return (
    <section
      classList={{ 'reading-page': true, 'helpdesk-page': true, 'inbox-page': !!props.inbox }}
    >
      <div class="connections-heading">
        <PageHeading title={props.inbox ? 'Inbox' : 'My Requests'} />
        <Show when={props.inbox}>
          <div
            class="inbox-status-filters"
            role="tablist"
            aria-label="Inbox folder"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'primary'
                  : event.key === 'End'
                    ? 'archive'
                    : inboxTab() === 'primary'
                      ? 'archive'
                      : 'primary';
              changeInboxTab(next);
              document.getElementById(`inbox-tab-${next}`)?.focus();
            }}
          >
            <For
              each={[
                ['primary', 'Primary'],
                ['archive', 'Archive'],
              ]}
            >
              {([value, label]) => (
                <button
                  type="button"
                  class="inbox-filter-button"
                  id={`inbox-tab-${value}`}
                  role="tab"
                  aria-controls="inbox-folder-panel"
                  aria-selected={inboxTab() === value}
                  tabindex={inboxTab() === value ? 0 : -1}
                  disabled={!!busyIds().length}
                  onClick={() => changeInboxTab(value)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show
        when={session()?.user && !session().user.isDemo}
        fallback={
          <p>
            <A href="/login">Sign in</A> to view your requests.
          </p>
        }
      >
        <div data-list-actions class="inbox-toolbar" classList={{ 'requests-list-toolbar': true }}>
          <label class="workspace-search" hidden={isListEmpty()}>
            <Icon name="search" />
            <input
              type="search"
              maxlength="200"
              aria-label={props.inbox ? 'Search Inbox' : 'Search My Requests'}
              placeholder={props.inbox ? 'Search inbox…' : 'Search requests…'}
              value={requestQuery()}
              onInput={(event) => setRequestQuery(event.currentTarget.value)}
            />
          </label>
          <Show
            when={props.inbox}
            fallback={
              <div class="ticket-filter" hidden={isListEmpty() && !status()}>
                <Dropdown
                  ariaLabel="Request status filter"
                  value={status()}
                  onChange={setStatus}
                  options={[
                    '',
                    'open',
                    'waiting-for-employee',
                    'waiting-for-approval',
                    'escalated',
                    'resolved',
                  ].map((value) => ({
                    value,
                    label: value ? statusLabel(value) : 'All Statuses',
                  }))}
                />
              </div>
            }
          ></Show>
        </div>
        <Show when={requests.error}>
          <ToastMessage tone="error">{requests.error.message}</ToastMessage>
        </Show>

        <Show
          when={props.inbox}
          fallback={
            <RecordTable
              bulkDelete="requests"
              onEmptyChange={setIsListEmpty}
              label={props.inbox ? 'Inbox' : 'My Requests'}
              emptyAction={{ label: 'Start Chat', href: '/workspace/chat' }}
              source="/api/helpdesk/requests"
              query={requestQuery()}
              sourceParams={{ status: status() || undefined }}
              refreshKey={revision()}
              onRowsChange={setPageRows}
              rows={visibleRequests()}
              defaultSort={{ key: 'Updated', direction: 'desc' }}
              columns={[
                {
                  label: 'Request',
                  sortValue: (ticket) => ticket.title,
                  render: (ticket) => (
                    <A
                      class="article-table-title"
                      href={
                        ticket.chatId
                          ? `/workspace/chat/${ticket.chatId}?request=${ticket.id}`
                          : `/workspace/requests/${ticket.id}`
                      }
                    >
                      <span>
                        <strong>{ticket.title}</strong>
                        <small>
                          {ticket.number || 'Request'} · {displayLabel(ticket.priority)} Priority
                        </small>
                      </span>
                    </A>
                  ),
                },
                {
                  label: 'Status',
                  sortValue: (ticket) => statusLabel(ticket.status),
                  render: (ticket) => (
                    <span
                      class="activity-status"
                      data-tone={
                        ticket.status === 'resolved'
                          ? 'positive'
                          : ticket.status === 'escalated'
                            ? 'warning'
                            : 'informational'
                      }
                    >
                      <span class="activity-status-dot" />
                      {statusLabel(ticket.status)}
                    </span>
                  ),
                },
                {
                  key: 'Queue',
                  label: 'Assignment Group',
                  sortValue: (ticket) => displayLabel(ticket.queueName),
                  render: (ticket) => displayLabel(ticket.queueName),
                },
                {
                  label: 'Updated',
                  defaultDirection: 'desc',
                  sortValue: (ticket) => Date.parse(ticket.updatedAt),
                  render: (ticket) => (
                    <time datetime={ticket.updatedAt}>
                      {new Date(ticket.updatedAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  ),
                },
              ]}
              emptyText={
                requests.loading
                  ? 'Loading requests…'
                  : props.inbox
                    ? 'Your inbox is clear.'
                    : 'No requests match this view.'
              }
            />
          }
        >
          <InboxList
            onEmptyChange={setIsListEmpty}
            query={requestQuery()}
            refreshKey={revision()}
            onRowsChange={setPageRows}
            items={visibleRequests()}
            loading={requests.loading}
            archived={inboxTab() === 'archive'}
            busyIds={busyIds()}
            processedCount={processedCount()}
            selectedIds={selectedVisible()}
            onSelect={(id, checked) =>
              setSelectedIds((items) =>
                checked ? [...new Set([...items, id])] : items.filter((item) => item !== id),
              )
            }
            onSelectAll={(checked) =>
              setSelectedIds(checked ? visibleRequests().map((item) => item.id) : [])
            }
            onBulkArchive={() => archiveItems(selectedVisible())}
          />
        </Show>
      </Show>
      <Show when={pendingArchive()}>
        <WorkspaceModal
          title={`Archive ${pendingArchive().length === 1 ? 'Item' : `${pendingArchive().length} Items`}?`}
          onClose={() => setPendingArchive(null)}
        >
          <p>Move the selected {pendingArchive().length === 1 ? 'item' : 'items'} to Archive?</p>
          <ul class="archive-confirmation-items">
            <For each={visibleRequests().filter((item) => pendingArchive().includes(item.id))}>
              {(item) => <li>{item.title}</li>}
            </For>
          </ul>
          <div class="helpdesk-actions">
            <button class="workspace-button secondary" onClick={() => setPendingArchive(null)}>
              Cancel
            </button>
            <button
              class="workspace-button"
              onClick={() => {
                const ids = pendingArchive();
                setPendingArchive(null);
                executeArchive(ids);
              }}
            >
              Archive
            </button>
          </div>
        </WorkspaceModal>
      </Show>
    </section>
  );
}
