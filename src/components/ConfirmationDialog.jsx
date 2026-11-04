import { Show, createSignal, createEffect } from 'solid-js';
import WorkspaceModal from './WorkspaceModal.jsx';
import { pendingConfirmation, finishConfirmation } from '../services/confirmations.js';
export default function ConfirmationDialog() {
  const [typed, setTyped] = createSignal('');
  createEffect(() => {
    pendingConfirmation();
    setTyped('');
  });
  return (
    <Show when={pendingConfirmation()}>
      {(item) => (
        <WorkspaceModal
          title={item().title}
          onClose={() => {
            if (pendingConfirmation() === item()) finishConfirmation(false);
          }}
        >
          <p>{item().message}</p>
          <Show when={item().requiredText}>
            <label>
              Type {item().requiredText} to confirm
              <input
                aria-label="Confirmation name"
                value={typed()}
                onInput={(event) => setTyped(event.currentTarget.value)}
                autocomplete="off"
              />
            </label>
          </Show>
          <div class="helpdesk-actions">
            <button
              type="button"
              class="workspace-button secondary"
              autofocus
              onClick={() => finishConfirmation(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              class="workspace-button"
              disabled={!!item().requiredText && typed() !== item().requiredText}
              onClick={() => finishConfirmation(true)}
            >
              {item().confirmLabel}
            </button>
          </div>
        </WorkspaceModal>
      )}
    </Show>
  );
}
