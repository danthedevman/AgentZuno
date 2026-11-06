import { Show, createSignal, createEffect, createUniqueId } from 'solid-js';
import WorkspaceModal from './WorkspaceModal.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import { pendingConfirmation, finishConfirmation } from '../services/confirmations.js';
export default function ConfirmationDialog() {
  const [typed, setTyped] = createSignal('');
  const instructionId = createUniqueId();
  createEffect(() => {
    pendingConfirmation();
    setTyped('');
  });
  return (
    <Show when={pendingConfirmation()} keyed>
      {(item) => (
        <WorkspaceModal
          title={item.title}
          onClose={() => {
            if (pendingConfirmation() === item) finishConfirmation(false);
          }}
        >
          <ValidatedForm
            class="create-form confirmation-form"
            validateField={(field) =>
              item.requiredText && field.value !== item.requiredText
                ? 'Enter the exact name to confirm.'
                : ''
            }
            onSubmit={() => finishConfirmation(true)}
          >
            <p class="confirmation-message">{item.message}</p>
            <Show when={item.requiredText}>
              <label>
                Confirmation name
                <input
                  name="confirmationName"
                  aria-label="Confirmation name"
                  required
                  aria-describedby={instructionId}
                  value={typed()}
                  onInput={(event) => setTyped(event.currentTarget.value)}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                />
                <small id={instructionId} class="confirmation-instruction">
                  Type “{item.requiredText}” to confirm.
                </small>
              </label>
            </Show>
            <div class="confirmation-actions">
              <button
                type="button"
                class="workspace-button secondary"
                autofocus
                onClick={() => finishConfirmation(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="workspace-button"
                disabled={!!item.requiredText && typed() !== item.requiredText}
              >
                {item.confirmLabel}
              </button>
            </div>
          </ValidatedForm>
        </WorkspaceModal>
      )}
    </Show>
  );
}
