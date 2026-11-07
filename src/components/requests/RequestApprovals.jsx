import { For, Show, createResource, createSignal, createEffect, onCleanup } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api } from '../../services/api.js';
import { displayLabel } from '../../utils/displayLabels.js';
import Skeleton from '../Skeleton.jsx';
import ApprovalDecisionForm from './ApprovalDecisionForm.jsx';
import ToastMessage from '../ToastMessage.jsx';

const dateLabel = (value) => (value ? new Date(value).toLocaleString() : '');
export default function RequestApprovals(props) {
  const [decisionError, setDecisionError] = createSignal('');
  const [rows, setRows] = createStore([]);
  const [history, { refetch }] = createResource(
    () => props.requestId,
    async (id) => {
      const result = await api(`/api/helpdesk/requests/${id}/approvals`);
      setRows(reconcile(result, { key: 'id' }));
      return rows;
    },
  );
  createEffect(() => {
    props.requestId;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refetch().catch(() => {});
    }, 5000);
    onCleanup(() => clearInterval(timer));
  });
  return (
    <section class="request-approvals" aria-label="Request approvals">
      <Show when={history.loading && !history.latest}>
        <Skeleton label="Loading approvals" lines={4} />
      </Show>
      <Show when={decisionError()}>
        <ToastMessage tone="error" message={decisionError()} />
      </Show>
      <Show when={history.error}>
        <p role="alert">Approval history could not be loaded.</p>
      </Show>
      <Show when={!history.error && history()}>
        <Show
          when={rows.length}
          fallback={<p class="empty-state">No approvals have been recorded for this request.</p>}
        >
          <For each={rows}>
            {(row) => (
              <article class="request-approval-row">
                <div class="request-approval-heading">
                  <h3>{row.target || displayLabel(row.title)}</h3>
                  <span
                    class="activity-status"
                    data-tone={
                      row.status === 'approved'
                        ? 'positive'
                        : ['rejected', 'failed', 'blocked'].includes(row.status)
                          ? 'warning'
                          : 'informational'
                    }
                  >
                    <span class="activity-status-dot" />
                    {displayLabel(row.status)}
                  </span>
                </div>
                <Show when={row.reason}>
                  <p>{row.reason}</p>
                </Show>
                <Show when={row.explanation}>
                  <p>{row.explanation}</p>
                </Show>
                <Show when={row.revision}>
                  <p class="request-approval-meta">Workflow version {row.revision}</p>
                </Show>
                <Show when={row.createdAt}>
                  <p class="request-approval-meta">
                    Requested <time datetime={row.createdAt}>{dateLabel(row.createdAt)}</time>
                  </p>
                </Show>
                <Show when={row.completedAt}>
                  <p class="request-approval-meta">
                    {row.decidedBy ? `Decision by ${row.decidedBy}` : 'Recorded'} ·{' '}
                    <time datetime={row.completedAt}>{dateLabel(row.completedAt)}</time>
                  </p>
                </Show>
                <Show when={row.comment}>
                  <p>{row.comment}</p>
                </Show>
                <Show when={row.canDecide}>
                  <ApprovalDecisionForm
                    requireComment={row.requireRejectionComment}
                    onDecision={async (approved, comment) => {
                      setDecisionError('');
                      try {
                        await api(
                          row.runId
                            ? `/api/helpdesk/workflow-runs/${row.runId}/decisions`
                            : `/api/helpdesk/requests/${props.requestId}/approval-decisions`,
                          {
                            method: 'POST',
                            body: JSON.stringify(
                              row.runId
                                ? { stepId: row.stepId, approved, comment }
                                : {
                                    version: props.version,
                                    approvalId: row.id,
                                    decision: approved ? 'approved' : 'rejected',
                                    comment,
                                  },
                            ),
                          },
                        );
                        await refetch();
                        await props.onChanged?.();
                        return true;
                      } catch (error) {
                        setDecisionError(error.message);
                        return false;
                      }
                    }}
                  />
                </Show>
              </article>
            )}
          </For>
        </Show>
      </Show>
    </section>
  );
}
