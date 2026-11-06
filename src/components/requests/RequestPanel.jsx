import RequestAccess from './RequestAccess.jsx';
import MentionTextarea from '../MentionTextarea.jsx';
import { createStore, reconcile } from 'solid-js/store';
import ApprovalDecisionForm from './ApprovalDecisionForm.jsx';
import RequestTasks from './RequestTasks.jsx';
import RequestAttachments from './RequestAttachments.jsx';
import { Portal } from 'solid-js/web';
import Breadcrumbs from '../Breadcrumbs.jsx';
import ReferenceArrow from '../ReferenceArrow.jsx';
import ProfileAvatar from '../identity/ProfileAvatar.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import Skeleton from '../Skeleton.jsx';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';
import { displayLabel, statusLabel } from '../../services/displayLabels.js';
import ToastMessage from '../ToastMessage.jsx';
import { For, Show, createResource, createSignal, createEffect, onCleanup } from 'solid-js';
import { useParams, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { api } from '../../services/api.js';
import Dropdown from '../Dropdown.jsx';
import ValidatedForm from '../ValidatedForm.jsx';

const dateLabel = (value) => (value ? new Date(value).toLocaleString() : '—');
const labels = (value) => statusLabel(value) || '—';
export default function RequestPanel(props) {
  let panel;
  const params = useParams();
  const [query] = useSearchParams();
  const requestId = () => props.requestId || params.id;
  createEffect(() => {
    requestId();
    if (panel) panel.scrollTop = 0;
  });
  const { session } = useSession();
  const { access } = useWorkspace();
  const [assignmentGroups] = createResource(
    () => access()?.role === 'admin',
    () => api('/api/helpdesk/groups'),
  );
  const [ticket, { refetch }] = createResource(
    () => `${requestId()}:${props.refreshKey || 0}`,
    () => api(`/api/helpdesk/requests/${requestId()}`),
  );
  const current = () => (ticket.error ? null : ticket());
  const [stableRuns, setStableRuns] = createStore([]);
  const [workflowRuns, { refetch: refreshRuns }] = createResource(
    () =>
      current()?.workflowId &&
      (['admin', 'agent'].includes(access()?.role) || access()?.canApprove) &&
      requestId(),
    async (id) => {
      const runs = await api(`/api/helpdesk/workflow-runs?requestId=${id}`);
      setStableRuns(reconcile(runs, { key: 'id' }));
      return stableRuns;
    },
  );
  createEffect(() => {
    if (
      !current()?.workflowId ||
      !(['admin', 'agent'].includes(access()?.role) || access()?.canApprove)
    )
      return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshRuns().catch(() => {});
    }, 5000);
    onCleanup(() => clearInterval(timer));
  });
  const [status, setStatus] = createSignal('open');
  const [priority, setPriority] = createSignal('normal');
  const [mode, setMode] = createSignal('comment');
  const [comment, setComment] = createSignal('');
  const [mentionIds, setMentionIds] = createSignal({});
  const [workNote, setWorkNote] = createSignal('');
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [detailTab, setDetailTab] = createSignal(query.tab === 'tasks' ? 'tasks' : 'details');
  const [isEditing, setIsEditing] = createSignal(false);
  const [editVersion, setEditVersion] = createSignal(null);
  function beginEdit() {
    setStatus(current().status);
    setPriority(current().priority);
    setEditVersion(current().version);
    setIsEditing(true);
  }
  const canWork = () => current()?.permissions?.canWork === true;
  createEffect(() => {
    if (current() && !isEditing()) {
      setStatus(current().status);
      setPriority(current().priority);
    }
    if (!canWork()) {
      setMode('comment');
      setIsEditing(false);
    }
  });
  async function save(suffix, method, body) {
    setSaving(true);
    setError('');
    try {
      await api(`/api/helpdesk/requests/${requestId()}${suffix}`, {
        method,
        body: JSON.stringify({ version: current().version, ...body }),
      });
      await refetch();
      props.onChanged?.();
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  const authorName = (entry) =>
    entry.authorName ||
    (entry.authorId === 'zuno' ? 'Zuno' : entry.role === 'requester' ? 'Requester' : 'Support');
  const entries = () =>
    mode() === 'work-note' ? current()?.workNotes || [] : current()?.messages || [];
  const RequestActions = () => (
    <div class="request-header-actions">
      <Show
        when={
          canWork() &&
          access()?.queues?.includes(current().queueName) &&
          !current().assignedToId &&
          current().status !== 'resolved'
        }
      >
        <button
          type="button"
          class="workspace-button secondary small"
          disabled={saving()}
          onClick={() => save('/assign-self', 'POST', {})}
        >
          Assign to Me
        </button>
      </Show>
      <Show when={canWork() && !isEditing()}>
        <button type="button" class="workspace-button small" onClick={beginEdit}>
          <Icon name="edit" />
          Edit Request
        </button>
      </Show>
      <Show when={canWork() && isEditing()}>
        <button
          class="workspace-button small"
          type="submit"
          form="ticket-details-form"
          disabled={saving() || current().status === 'waiting-for-approval'}
        >
          <Icon name="check" />
          {saving() ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          class="workspace-button secondary small"
          type="button"
          disabled={saving()}
          onClick={() => setIsEditing(false)}
        >
          Cancel
        </button>
      </Show>
    </div>
  );
  return (
    <section ref={panel} class="request-workspace-panel">
      <Show
        when={props.headerLocationTarget}
        fallback={
          <Breadcrumbs
            label="Request location"
            items={[
              { label: 'My Requests', href: '/workspace/requests' },
              { label: current()?.number || 'Request' },
            ]}
          />
        }
      >
        <Portal mount={props.headerLocationTarget}>
          {' '}
          <Breadcrumbs
            label="Request location"
            items={[
              { label: 'My Requests', href: '/workspace/requests' },
              { label: current()?.number || 'Request' },
            ]}
          />
        </Portal>
      </Show>
      <Show when={current()}>
        <Show when={props.headerActionsTarget} fallback={<RequestActions />}>
          <Portal mount={props.headerActionsTarget}>
            <RequestActions />
          </Portal>
        </Show>
      </Show>
      <Show when={ticket.error}>
        <ToastMessage tone="error">{ticket.error.message}</ToastMessage>
      </Show>
      <Show when={ticket.loading && !current()}>
        <div class="ticket-detail-loading">
          <div class="ticket-detail-heading">
            <Skeleton label="Loading request title" lines={1} />
          </div>
          <Skeleton label="Loading request summary" lines={2} />
          <Skeleton label="Loading submitted answers" lines={4} />
          <Skeleton label="Loading tracking and assignment" lines={6} />
          <Skeleton label="Loading request activity" lines={4} />
        </div>
      </Show>
      <Show when={current()}>
        {(item) => (
          <>
            <div class="ticket-detail-heading">
              <h2>{item().title}</h2>
              <span
                class="activity-status"
                data-tone={
                  item().status === 'resolved'
                    ? 'positive'
                    : item().status === 'escalated'
                      ? 'warning'
                      : 'informational'
                }
              >
                <span class="activity-status-dot" />
                {labels(item().status)}
              </span>
            </div>
            <RequestAccess requestId={requestId()} />
            <div class="record-detail-tabs" role="tablist" aria-label="Request sections">
              <button
                role="tab"
                aria-selected={detailTab() === 'details'}
                onClick={() => setDetailTab('details')}
              >
                Details
              </button>
              <button
                role="tab"
                aria-selected={detailTab() === 'attachments'}
                onClick={() => setDetailTab('attachments')}
              >
                Attachments
              </button>
              <button
                role="tab"
                aria-selected={detailTab() === 'tasks'}
                onClick={() => setDetailTab('tasks')}
              >
                Tasks
              </button>
            </div>
            <Show when={detailTab() === 'tasks'}>
              <RequestTasks
                refreshKey={props.refreshKey}
                requestId={requestId()}
                workspaceId={params.workspaceId}
                canManage={canWork() && current()?.status !== 'resolved' && !isEditing()}
                onChanged={async () => {
                  await refetch();
                  await props.onChanged?.();
                }}
              />
            </Show>
            <Show when={detailTab() === 'attachments'}>
              <RequestAttachments
                requestId={requestId()}
                canUpload={
                  !isEditing() &&
                  access()?.role !== 'read-only' &&
                  (current()?.requesterId === session()?.user?.id || canWork()) &&
                  current()?.status !== 'resolved'
                }
                onChanged={async () => {
                  await refetch();
                  await props.onChanged?.();
                }}
              />
            </Show>
            <div class="ticket-detail-layout" hidden={detailTab() !== 'details'}>
              <div class="ticket-detail-content">
                <section class="ticket-description" aria-label="Request description">
                  <p>{item().description}</p>
                </section>
                <Show when={item().formSubmission}>
                  <section class="ticket-submitted-form">
                    <h3>Submitted Answers</h3>
                    <dl>
                      <For each={item().formSubmission.answers}>
                        {(answer) => (
                          <div>
                            <dt>{answer.label}</dt>
                            <dd>
                              {typeof answer.value === 'boolean'
                                ? answer.value
                                  ? 'Yes'
                                  : 'No'
                                : answer.displayValue || answer.value || '—'}
                            </dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </section>
                </Show>
                <aside class="ticket-detail-panel" aria-label="Request information">
                  <h3>Tracking & Assignment</h3>
                  <Show
                    when={canWork() && isEditing()}
                    fallback={
                      <dl class="ticket-facts">
                        <div>
                          <dt>Status</dt>
                          <dd>{labels(item().status)}</dd>
                        </div>
                        <div>
                          <dt>Priority</dt>
                          <dd>{displayLabel(item().priority)}</dd>
                        </div>
                      </dl>
                    }
                  >
                    <ValidatedForm
                      id="ticket-details-form"
                      class="ticket-details-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (!isEditing()) return;
                        if (
                          await save('', 'PATCH', {
                            version: editVersion(),
                            status: status(),
                            priority: priority(),
                          })
                        )
                          setIsEditing(false);
                      }}
                    >
                      <label>
                        Status
                        <Dropdown
                          name="status"
                          ariaLabel="Request status"
                          value={status()}
                          onChange={setStatus}
                          options={[
                            'open',
                            'waiting-for-employee',
                            'escalated',
                            'resolved',
                            ...(item().status === 'waiting-for-approval'
                              ? ['waiting-for-approval']
                              : []),
                          ].map((value) => ({ value, label: labels(value) }))}
                          readOnly={item().status === 'waiting-for-approval'}
                        />
                      </label>
                      <label>
                        Priority
                        <Dropdown
                          name="priority"
                          ariaLabel="Request priority"
                          value={priority()}
                          onChange={setPriority}
                          options={['low', 'normal', 'high', 'urgent'].map((value) => ({
                            value,
                            label: displayLabel(value),
                          }))}
                        />
                      </label>
                    </ValidatedForm>
                  </Show>

                  <Show when={item().assignedToId}>
                    <div class="request-assignee">
                      <ProfileAvatar userId={item().assignedToId} name={item().assignedToName} />
                      <span>Assigned to {item().assignedToName}</span>
                      <Show when={access()?.role === 'admin'}>
                        <ReferenceArrow
                          href={`/workspace/users/${item().assignedToId}`}
                          label={item().assignedToName}
                        />
                      </Show>
                    </div>
                  </Show>
                  <dl class="ticket-facts">
                    <div>
                      <dt>Assignment Group</dt>
                      <dd>
                        <span class="request-queue-label">
                          {displayLabel(item().queueName) || 'Unassigned'}
                          <ReferenceArrow
                            href={
                              assignmentGroups()?.find((group) => group.name === item().queueName)
                                ? `/workspace/users/groups/${assignmentGroups().find((group) => group.name === item().queueName).id}`
                                : ''
                            }
                            label={item().queueName}
                          />
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Number</dt>
                      <dd>{item().number || item().id}</dd>
                    </div>
                    <div>
                      <dt>Requested by</dt>
                      <dd>
                        {item().requesterName || item().emailSender || 'Requester'}
                        <Show when={access()?.role === 'admin' && item().requesterId}>
                          <ReferenceArrow
                            href={`/workspace/users/${item().requesterId}`}
                            label={item().requesterName}
                          />
                        </Show>
                        <Show when={item().requesterEmail}>
                          <small>{item().requesterEmail}</small>
                        </Show>
                      </dd>
                    </div>

                    <div>
                      <dt>Workflow</dt>
                      <dd>
                        <Show when={item().workflow} fallback="—">
                          <Show when={item().workflow?.canOpen} fallback={item().workflow?.name}>
                            <A href={`/workspace/workflows/${item().workflow.id}/edit`}>
                              {item().workflow.name}
                            </A>
                            <ReferenceArrow
                              href={`/workspace/workflows/${item().workflow.id}/edit`}
                              label={item().workflow.name}
                            />
                          </Show>
                          <Show when={item().workflow?.version}>
                            <small>Revision {item().workflow.version}</small>
                          </Show>
                        </Show>
                      </dd>
                    </div>
                    <div>
                      <dt>Channel</dt>
                      <dd>
                        {item().channel === 'web'
                          ? 'Web'
                          : item().channel === 'email'
                            ? 'Email'
                            : displayLabel(item().channel)}
                      </dd>
                    </div>
                    <div>
                      <dt>Submitted through</dt>
                      <dd>
                        {item().submittedVia === 'zuno'
                          ? 'Zuno'
                          : item().submittedVia === 'email'
                            ? 'Support inbox'
                            : 'User'}
                      </dd>
                    </div>
                    <div>
                      <dt>Created</dt>
                      <dd>
                        <time datetime={item().createdAt}>{dateLabel(item().createdAt)}</time>
                      </dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>
                        <time datetime={item().updatedAt}>{dateLabel(item().updatedAt)}</time>
                      </dd>
                    </div>
                  </dl>
                  <Show when={item().channel === 'email'}>
                    <h3>Email delivery</h3>
                    <For each={item().emailReplies || []}>
                      {(reply) => (
                        <p class="chat-response-status">
                          {{
                            draft: 'Draft saved for review',
                            generating: 'Zuno is preparing a response',
                            sent: 'Sent',
                            sending: 'Delivery started — do not resend',
                            'delivery-unknown': 'Delivery uncertain — review before resending',
                            'needs-review': 'Needs support team review',
                            received: 'Received',
                          }[reply.status] || reply.status}
                          <Show when={reply.draftText}>
                            <span class="email-draft-text">{reply.draftText}</span>
                          </Show>
                        </p>
                      )}
                    </For>
                  </Show>
                </aside>
                <For each={!workflowRuns.error ? workflowRuns() || [] : []}>
                  {(run) => (
                    <For
                      each={run.steps.filter(
                        (step) =>
                          step.status === 'awaiting-approval' &&
                          (step.resolvedUserIds || [step.input.userId]).includes(
                            session()?.user?.id,
                          ),
                      )}
                    >
                      {(step) => (
                        <section class="workflow-approval">
                          <h3>Workflow Approval</h3>
                          <p>{step.input.reason}</p>
                          <ApprovalDecisionForm
                            requireComment={step.requireRejectionComment}
                            onDecision={async (approved, comment) => {
                              try {
                                await api(`/api/helpdesk/workflow-runs/${run.id}/decisions`, {
                                  method: 'POST',
                                  body: JSON.stringify({ stepId: step.id, approved, comment }),
                                });
                                await refreshRuns();
                                props.onChanged?.();
                                return true;
                              } catch (error) {
                                setError(error.message);
                                return false;
                              }
                            }}
                          />
                        </section>
                      )}
                    </For>
                  )}
                </For>
                <section class="ticket-journal">
                  <div class="ticket-journal-tabs" role="group" aria-label="Request activity type">
                    <button
                      type="button"
                      aria-pressed={mode() === 'comment'}
                      onClick={() => setMode('comment')}
                    >
                      Comments <span>{item().messages?.length || 0}</span>
                    </button>
                    <Show when={canWork()}>
                      <button
                        type="button"
                        aria-pressed={mode() === 'work-note'}
                        onClick={() => setMode('work-note')}
                      >
                        Work notes <span>{item().workNotes?.length || 0}</span>
                      </button>
                    </Show>
                  </div>
                  <Show when={mode() === 'work-note'}>
                    <p class="ticket-internal-label">
                      Internal · Visible to Admins and assigned support Agents.
                    </p>
                  </Show>
                  <Show when={mode() === 'work-note' ? canWork() : item().status !== 'resolved'}>
                    <ValidatedForm
                      class="ticket-journal-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const internal = mode() === 'work-note';
                        if (
                          await save(internal ? '/work-notes' : '/comments', 'POST', {
                            text: internal ? workNote() : comment(),
                            mentionIds: mentionIds()[mode()] || [],
                          })
                        ) {
                          if (internal) setWorkNote('');
                          else setComment('');
                        }
                      }}
                    >
                      <label>
                        {mode() === 'work-note' ? 'Work note' : 'Comment'}
                        <MentionTextarea
                          id="ticket-journal-entry"
                          name="entry"
                          required
                          maxlength="8000"
                          rows="4"
                          requestId={requestId()}
                          kind={mode() === 'work-note' ? 'work-note' : 'comment'}
                          value={mode() === 'work-note' ? workNote() : comment()}
                          onInput={(value) =>
                            mode() === 'work-note' ? setWorkNote(value) : setComment(value)
                          }
                          onMentionsChange={(ids) =>
                            setMentionIds((values) => ({ ...values, [mode()]: ids }))
                          }
                        />
                      </label>
                      <button class="workspace-button small" disabled={saving()}>
                        {saving()
                          ? 'Saving…'
                          : mode() === 'work-note'
                            ? 'Add work note'
                            : 'Add comment'}
                      </button>
                    </ValidatedForm>
                  </Show>
                  <Show when={!entries().length}>
                    <p class="ticket-journal-empty">
                      {mode() === 'work-note' ? 'No work notes yet.' : 'No comments yet.'}
                    </p>
                  </Show>
                  <ol class="ticket-messages">
                    <For each={[...entries()].reverse()}>
                      {(entry) => (
                        <li>
                          <div>
                            <span class="ticket-journal-author">
                              <Show
                                when={entry.authorId === 'zuno'}
                                fallback={
                                  <ProfileAvatar
                                    userId={entry.authorId}
                                    name={authorName(entry)}
                                    refreshKey={
                                      entry.authorId === session()?.user?.id
                                        ? session()?.user?.profilePictureVersion
                                        : undefined
                                    }
                                  />
                                }
                              >
                                <Icon name="agent" />
                              </Show>
                              <strong>{authorName(entry)}</strong>
                            </span>
                            <time datetime={entry.createdAt}>{dateLabel(entry.createdAt)}</time>
                          </div>
                          <p>{entry.text}</p>
                        </li>
                      )}
                    </For>
                  </ol>
                </section>
                <For each={item().approvals || []}>
                  {(approval) => (
                    <section class="ticket-approval">
                      <h3>{labels(approval.action)}</h3>
                      <p>{approval.reason}</p>
                      <p>{displayLabel(approval.status)}</p>
                      <Show
                        when={
                          approval.status === 'pending' &&
                          canWork() &&
                          !access?.error &&
                          access()?.canApprove
                        }
                      >
                        <ApprovalDecisionForm
                          disabled={saving()}
                          onDecision={(approved, comment) =>
                            save('/approval-decisions', 'POST', {
                              approvalId: approval.id,
                              decision: approved ? 'approved' : 'rejected',
                              comment,
                            })
                          }
                        />
                      </Show>
                    </section>
                  )}
                </For>
              </div>
            </div>
          </>
        )}
      </Show>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
    </section>
  );
}
