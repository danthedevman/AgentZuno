import { Show } from 'solid-js';
import WorkspaceModal from './WorkspaceModal.jsx';
import { pendingConfirmation, finishConfirmation } from '../services/confirmations.js';
export default function ConfirmationDialog() {
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
          <div class="helpdesk-actions">
            <button
              type="button"
              class="workspace-button secondary"
              autofocus
              onClick={() => finishConfirmation(false)}
            >
              Cancel
            </button>
            <button type="button" class="workspace-button" onClick={() => finishConfirmation(true)}>
              {item().confirmLabel}
            </button>
          </div>
        </WorkspaceModal>
      )}
    </Show>
  );
}
