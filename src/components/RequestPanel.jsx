import ReferenceArrow from './ReferenceArrow.jsx';
import ProfileAvatar from './ProfileAvatar.jsx';
import { useSession } from '../context/SessionContext.jsx';
import Skeleton from './Skeleton.jsx';
import A from './WorkspaceLink.jsx';
import Icon from './Icon.jsx';
import { displayLabel, statusLabel } from '../services/displayLabels.js';
import ToastMessage from './ToastMessage.jsx';
import { For, Show, createResource, createSignal, createEffect, onCleanup } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { api } from '../services/api.js';
import Dropdown from './Dropdown.jsx';
import PageHeading from './PageHeading.jsx';
import ValidatedForm from './ValidatedForm.jsx';

const dateLabel = (value) => (value ? new Date(value).toLocaleString() : '—');
const labels = (value) => statusLabel(value) || '—';
export default function RequestPanel(props) {
  let panel;
  const params = useParams();
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
  const [approvalComments, setApprovalComments] = createSignal({});
  const [ticket, { refetch }] = createResource(
    () => requestId(),
    (id) => api(`/api/helpdesk/requests/${id}`),
  );
  const current = () => (ticket.error ? null : ticket());
  const [workflowRuns, { refetch: refreshRuns }] = createResource(
    () =>
      current()?.workflowId &&
      (['admin', 'agent'].includes(access()?.role) || access()?.canApprove) &&
      requestId(),
    (id) => api(`/api/helpdesk/workflow-runs?requestId=${id}`),
  );
  createEffect(() => {
    if (
      !current()?.workflowId ||
      !(['admin', 'agent'].includes(access()?.role) || access()?.canApprove)
    )
      return;
    const timer = setInterval(() => refreshRuns().catch(() => {}), 5000);
    onCleanup(() => clearInterval(timer));
  });
  const [status, setStatus] = createSignal('open');
  const [priority, setPriority] = createSignal('normal');
  const [mode, setMode] = createSignal('comment');
  const [comment, setComment] = createSignal('');
  const [workNote, setWorkNote] = createSignal('');
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
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
  const entries = () =>
    mode() === 'work-note' ? current()?.workNotes || [] : current()?.messages || [];
  return (
    <section ref={panel} class="request-workspace-panel">
      <PageHeading title={current()?.number || 'Request'} />
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
            <div class="ticket-detail-layout">
              <div class="ticket-detail-content">
                <section class="ticket-description">
                  <h3>Details</h3>
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
                                : answer.value || '—'}
                            </dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </section>
                </Show>
                <aside class="ticket-detail-panel" aria-label="Request information">
                  <section class="record-panel-actions">
                    <h3>Actions</h3>
                    <Show
                      when={
                        canWork() &&
                        access()?.queues?.includes(item().queueName) &&
                        !item().assignedToId &&
                        item().status !== 'resolved'
                      }
                    >
                      <button
                        type="button"
                        class="workspace-button secondary"
                        disabled={saving()}
                        onClick={() => save('/assign-self', 'POST', {})}
                      >
                        Assign to Me
                      </button>
                    </Show>
                    <Show when={canWork() && !isEditing()}>
                      <button type="button" class="workspace-button" onClick={beginEdit}>
                        <Icon name="edit" />
                        Edit Request
                      </button>
                    </Show>
                    <Show when={canWork() && isEditing()}>
                      <button
                        class="workspace-button"
                        type="submit"
                        form="ticket-details-form"
                        disabled={saving() || item().status === 'waiting-for-approval'}
                      >
                        <Icon name="check" />
                        {saving() ? 'Saving…' : 'Save Changes'}
                      </button>
                      <button
                        class="workspace-button secondary"
                        type="button"
                        disabled={saving()}
                        onClick={() => setIsEditing(false)}
                      >
                        Cancel
                      </button>
                    </Show>
                  </section>
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
                          <label>
                            Rejection Comment{step.requireRejectionComment ? '*' : ''}
                            <textarea
                              maxlength="2000"
                              value={approvalComments()[`${run.id}:${step.id}`] || ''}
                              onInput={(event) =>
                                setApprovalComments((values) => ({
                                  ...values,
                                  [`${run.id}:${step.id}`]: event.currentTarget.value,
                                }))
                              }
                            />
                          </label>
                          <For each={[true, false]}>
                            {(approved) => (
                              <button
                                class="workspace-button secondary small"
                                onClick={async () => {
                                  try {
                                    await api(`/api/helpdesk/workflow-runs/${run.id}/decisions`, {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        stepId: step.id,
                                        approved,
                                        comment: approvalComments()[`${run.id}:${step.id}`] || '',
                                      }),
                                    });
                                    await refreshRuns();
                                    props.onChanged?.();
                                  } catch (error) {
                                    setError(error.message);
                                  }
                                }}
                              >
                                {approved ? 'Approve' : 'Reject'}
                              </button>
                            )}
                          </For>
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
                          })
                        ) {
                          if (internal) setWorkNote('');
                          else setComment('');
                        }
                      }}
                    >
                      <label>
                        {mode() === 'work-note' ? 'Work note' : 'Comment'}
                        <textarea
                          id="ticket-journal-entry"
                          name="entry"
                          required
                          maxlength="8000"
                          rows="4"
                          value={mode() === 'work-note' ? workNote() : comment()}
                          onInput={(event) =>
                            mode() === 'work-note'
                              ? setWorkNote(event.currentTarget.value)
                              : setComment(event.currentTarget.value)
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
                            <strong>
                              {entry.authorName ||
                                (entry.authorId === 'zuno'
                                  ? 'Zuno'
                                  : entry.role === 'requester'
                                    ? 'Requester'
                                    : 'Support')}
                            </strong>
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
                        <ValidatedForm
                          onSubmit={(event) => {
                            event.preventDefault();
                            save('/approval-decisions', 'POST', {
                              approvalId: approval.id,
                              decision: event.submitter.value,
                            });
                          }}
                        >
                          <button
                            class="workspace-button small"
                            name="decision"
                            value="approved"
                            disabled={saving()}
                          >
                            Approve
                          </button>
                          <button
                            class="workspace-button secondary small"
                            name="decision"
                            value="rejected"
                            disabled={saving()}
                          >
                            Reject
                          </button>
                        </ValidatedForm>
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
