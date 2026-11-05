import { Show, createResource, createSignal } from 'solid-js';
import { useSearchParams, useNavigate } from '@solidjs/router';
import { api } from '../services/api.js';
import { useWorkspacePath } from '../services/workspaceRoutes.js';
import { useToasts } from '../context/ToastContext.jsx';
import { confirmAction } from '../services/confirmations.js';
import ToastMessage from './ToastMessage.jsx';
export default function DataRecordDeletion(props) {
  const [query] = useSearchParams(),
    navigate = useNavigate(),
    path = useWorkspacePath();
  const { notify } = useToasts();
  const [busy, setBusy] = createSignal(false);
  const [review] = createResource(
    () => query.delete,
    (id) => api(`/api/helpdesk/data/deletions/${encodeURIComponent(id)}`),
  );
  async function remove() {
    setBusy(true);
    try {
      const proposal = query.delete
        ? review()
        : await api(
            `/api/helpdesk/data/tables/${props.tableId}/records/${props.recordId}/deletion-review`,
            { method: 'POST', body: JSON.stringify({ version: props.version }) },
          );
      const details = query.delete
        ? proposal
        : await api(`/api/helpdesk/data/deletions/${proposal.proposalId}`);
      if (details.tableId !== props.tableId || details.recordId !== props.recordId)
        throw new Error('The deletion review is for a different record.');
      if (
        !(await confirmAction(
          `Remove “${details.name}” from this data table? Its audit history is retained.`,
          'Delete Record',
          'Delete Record',
          { requiredText: details.name },
        ))
      )
        return;
      await api(`/api/helpdesk/data/deletions/${query.delete || proposal.proposalId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: true, name: details.name }),
      });
      notify({ tone: 'success', message: 'Record deleted.' });
      navigate(path(`/workspace/data/${props.tableId}`));
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Show when={review.error}>
        <ToastMessage tone="error">{review.error.message}</ToastMessage>
      </Show>
      <Show when={query.delete}>
        <p>
          A deletion was proposed for this record. Review it before confirming; no record has been
          removed.
        </p>
      </Show>
      <button
        type="button"
        class="workspace-button secondary small"
        disabled={busy() || review.loading || !!review.error}
        onClick={remove}
      >
        {query.delete ? 'Review Deletion' : 'Delete'}
      </button>
    </>
  );
}
