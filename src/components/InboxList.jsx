import ProfileAvatar from './ProfileAvatar.jsx';
import { api } from '../services/api.js';
import { useToasts } from '../context/ToastContext.jsx';
import RecordTable from './RecordTable.jsx';
import { displayLabel, statusLabel } from '../services/displayLabels.js';
import { Show, createEffect, createSignal } from 'solid-js';
import A from './WorkspaceLink.jsx';
import Icon from './Icon.jsx';

function SelectionCheckbox(props) {
  let input;
  createEffect(() => {
    if (input) input.indeterminate = !!props.indeterminate;
  });
  return (
    <input
      ref={input}
      type="checkbox"
      class="inbox-checkbox"
      aria-label={props.label}
      checked={props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
  );
}
export default function InboxList(props) {
  const [assignmentRevision, setAssignmentRevision] = createSignal(0);
  const [assigning, setAssigning] = createSignal('');
  const { notify } = useToasts();
  async function assign(item) {
    setAssigning(item.id);
    try {
      await api(`/api/helpdesk/requests/${item.id}/assign-self`, {
        method: 'POST',
        body: JSON.stringify({ version: item.version }),
      });
      setAssignmentRevision((value) => value + 1);
      notify({ tone: 'success', message: 'Assigned to you.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setAssigning('');
    }
  }

  return (
    <section
      id="inbox-folder-panel"
      role="tabpanel"
      aria-labelledby={`inbox-tab-${props.archived ? 'archive' : 'primary'}`}
    >
      <Show when={props.selectedIds?.length || props.busyIds?.length}>
        <div class="inbox-selection-actions" role="group" aria-label="Selected inbox items">
          <span role="status">
            {props.busyIds?.length
              ? `${props.archived ? 'Restoring' : 'Archiving'} ${props.processedCount} of ${props.busyIds.length}…`
              : `${props.selectedIds.length} selected`}
          </span>
          <button
            class="inbox-bulk-action"
            type="button"
            disabled={!!props.busyIds?.length || props.loading}
            onClick={props.onBulkArchive}
          >
            <Icon name={props.archived ? 'restore' : 'archive'} />
            {props.archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      </Show>
      <RecordTable
        onEmptyChange={props.onEmptyChange}
        label="Inbox"
        emptyAction={{ label: 'Start Chat', href: '/workspace/chat' }}
        query={props.query}
        source="/api/helpdesk/inbox"
        sourceParams={{ tab: props.archived ? 'archive' : 'primary' }}
        refreshKey={`${props.refreshKey}:${assignmentRevision()}`}
        onRowsChange={props.onRowsChange}
        rows={props.items}
        defaultSort={{ key: 'Updated', direction: 'desc' }}
        columns={[
          {
            label: 'Subject',
            sortValue: (item) => item.title,
            headerStart: () => (
              <SelectionCheckbox
                label="Select all visible inbox items"
                checked={!!props.items?.length && props.selectedIds?.length === props.items.length}
                indeterminate={
                  !!props.selectedIds?.length && props.selectedIds.length < props.items.length
                }
                disabled={props.loading || !!props.busyIds?.length || !props.items?.length}
                onChange={props.onSelectAll}
              />
            ),
            render: (item) => (
              <div class="inbox-table-subject">
                <SelectionCheckbox
                  label={`Select ${item.title}`}
                  checked={props.selectedIds?.includes(item.id)}
                  disabled={props.loading || !!props.busyIds?.length}
                  onChange={(checked) => props.onSelect(item.id, checked)}
                />
                <A
                  class="article-table-title"
                  href={
                    item.chatId
                      ? `/workspace/chat/${item.chatId}?request=${item.id}`
                      : `/workspace/requests/${item.id}`
                  }
                >
                  <span class="inbox-item-content">
                    <span class="inbox-item-heading">
                      <span class="inbox-item-number">{item.number}</span>
                      <strong>{item.title}</strong>
                      <span class="inbox-status-badge" data-status={item.status}>
                        <span class="inbox-status-dot" aria-hidden="true" />
                        {statusLabel(item.status)}
                      </span>
                    </span>
                    <Show when={item.description && item.description !== item.title}>
                      <span class="inbox-item-preview">{item.description.slice(0, 180)}</span>
                    </Show>
                    <span class="inbox-item-details">
                      <span class="inbox-detail-field">
                        <span class="inbox-detail-label">Requested By</span>
                        <span class="inbox-detail-value">
                          {item.requesterName || item.requesterEmail || 'Requester'}
                        </span>
                      </span>
                      <span class="inbox-detail-field">
                        <span class="inbox-detail-label">Assignment Group</span>
                        <span class="inbox-detail-value">
                          {item.queueName ? displayLabel(item.queueName) : 'Unassigned'}
                        </span>
                      </span>
                      <span class="inbox-detail-field">
                        <span class="inbox-detail-label">Assigned To</span>
                        <span class="request-assignee inbox-detail-value">
                          <Show when={item.assignedToId}>
                            <ProfileAvatar userId={item.assignedToId} name={item.assignedToName} />
                          </Show>
                          {item.assignedToId ? item.assignedToName || 'Agent' : 'Unassigned'}
                        </span>
                      </span>
                    </span>
                  </span>
                </A>
                <Show when={!item.assignedToId && item.status !== 'resolved'}>
                  <button
                    type="button"
                    class="workspace-button secondary small inbox-assign-button"
                    disabled={!!assigning()}
                    onClick={() => assign(item)}
                  >
                    {assigning() === item.id ? 'Assigning…' : 'Assign to Me'}
                  </button>
                </Show>
              </div>
            ),
          },
          {
            label: 'Updated',
            className: 'record-updated-column',
            defaultDirection: 'desc',
            sortValue: (item) => Date.parse(item.updatedAt),
            render: (item) => (
              <div class="record-cell-actions">
                <time datetime={item.updatedAt}>
                  {new Date(item.updatedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </div>
            ),
          },
        ]}
        emptyText={
          props.loading
            ? 'Loading inbox…'
            : props.archived
              ? 'No archived items.'
              : 'Your primary inbox is clear.'
        }
      />
    </section>
  );
}
