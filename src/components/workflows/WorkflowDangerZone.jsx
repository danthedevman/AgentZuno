import { createSignal } from 'solid-js';
import Toggle from '../Toggle.jsx';
import { api } from '../../services/api.js';
import { confirmAction } from '../../services/confirmations.js';
import { useToasts } from '../../context/ToastContext.jsx';

export default function WorkflowDangerZone(props) {
  const { notify } = useToasts();
  const [preserveRequests, setPreserveRequests] = createSignal(true);
  const [preserveHistory, setPreserveHistory] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  async function remove() {
    if (busy() || props.disabled || !props.workflow) return;
    const workflow = props.workflow;
    const choices = { preserveRequests: preserveRequests(), preserveHistory: preserveHistory() };
    setBusy(true);
    props.onBusy?.(true);
    try {
      const requests = choices.preserveRequests
        ? 'Existing requests and their tasks will be kept. Pending workflow approvals will return to open requests.'
        : 'Existing requests created by this workflow, their tasks, and request attachments will be deleted.';
      const history = choices.preserveHistory
        ? 'Workflow runs and saved versions will be kept.'
        : 'Workflow runs and saved versions will be deleted.';
      if (
        !(await confirmAction(
          `Delete “${workflow.name}”? ${requests} ${history} Pending runs will stop. Governance audit records will remain. Unsaved workflow edits will be discarded. This cannot be undone.`,
          'Delete Workflow',
          'Delete Workflow',
          { requiredText: workflow.name },
        ))
      )
        return;
      await api(`/api/helpdesk/workflows/${workflow.id}`, {
        method: 'DELETE',
        confirmed: true,
        body: JSON.stringify({
          confirmed: true,
          name: workflow.name,
          version: workflow.version,
          ...choices,
        }),
      });
      notify({ tone: 'success', message: 'Workflow deleted.', destination: props.destination });
      await props.onDeleted?.();
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
      props.onBusy?.(false);
    }
  }
  return (
    <section class="workflow-danger-zone" aria-label="Danger Zone">
      <h2>Danger Zone</h2>
      <p>
        Delete this workflow and stop new submissions. Choose what to keep before deleting.
        Governance audit records are always retained. Active or uncertain actions must finish or be
        reviewed first.
      </p>
      <div class="create-form">
        <Toggle
          label="Preserve existing requests"
          checked={preserveRequests()}
          disabled={busy() || props.disabled}
          onChange={setPreserveRequests}
        />
        <p class="field-help">Keep submitted requests, their tasks, and attachments.</p>
        <Toggle
          label="Preserve workflow history"
          checked={preserveHistory()}
          disabled={busy() || props.disabled}
          onChange={setPreserveHistory}
        />
        <p class="field-help">Keep execution runs and saved workflow versions.</p>
        <button
          type="button"
          class="workspace-button secondary"
          disabled={busy() || props.disabled}
          onClick={remove}
        >
          {busy() ? 'Deleting…' : 'Delete Workflow'}
        </button>
      </div>
    </section>
  );
}
