import { Show, createSignal } from 'solid-js';
import ValidatedForm from './ValidatedForm.jsx';

export default function ApprovalDecisionForm(props) {
  const [isRejecting, setRejecting] = createSignal(false);
  const [comment, setComment] = createSignal('');
  const [isSaving, setSaving] = createSignal(false);
  const isBusy = () => isSaving() || props.disabled;
  async function decide(approved) {
    if (isBusy()) return;
    setSaving(true);
    try {
      const saved = await props.onDecision(approved, approved ? '' : comment().trim());
      if (saved !== false) {
        setRejecting(false);
        setComment('');
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <Show
      when={isRejecting()}
      fallback={
        <div class="approval-decision-actions">
          <button
            type="button"
            class="workspace-button small"
            disabled={isBusy()}
            onClick={() => decide(true)}
          >
            Approve
          </button>
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={isBusy()}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        </div>
      }
    >
      <ValidatedForm
        class="approval-decision-form"
        onSubmit={(event) => {
          event.preventDefault();
          return decide(false);
        }}
      >
        <label>
          <span>Rejection Comment</span>
          <textarea
            name="rejectionComment"
            rows="4"
            maxlength="2000"
            required={props.requireComment}
            value={comment()}
            onInput={(event) => setComment(event.currentTarget.value)}
            placeholder="Explain your decision"
            disabled={isBusy()}
          />
        </label>
        <div class="approval-decision-actions">
          <button type="submit" class="workspace-button small" disabled={isBusy()}>
            {isBusy() ? 'Submitting…' : 'Confirm Rejection'}
          </button>
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={isBusy()}
            onClick={() => {
              setRejecting(false);
              setComment('');
            }}
          >
            Cancel
          </button>
        </div>
      </ValidatedForm>
    </Show>
  );
}
