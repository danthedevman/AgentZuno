import { createUniqueId, onCleanup, onMount } from 'solid-js';
import { openDialog, releaseDialog } from '../services/dialogs.js';
import Icon from './Icon.jsx';
import { Portal } from 'solid-js/web';

export default function WorkspaceModal(props) {
  let dialog;
  let closing = false;
  async function requestClose() {
    if (closing) return;
    closing = true;
    try {
      if (!props.beforeClose || (await props.beforeClose())) dialog.close();
    } finally {
      closing = false;
    }
  }
  const titleId = createUniqueId();
  onMount(() => openDialog(dialog));
  onCleanup(() => {
    dialog?.close();
    releaseDialog(dialog);
  });
  return (
    <Portal mount={document.querySelector('.workspace-shell') || document.body}>
      <div class="workspace-overlay-backdrop" onClick={requestClose} />
      <dialog
        ref={dialog}
        class="create-picker workspace-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onClose={() => {
          releaseDialog(dialog);
          props.onClose();
        }}
      >
        <div class="create-picker-heading">
          <h2 id={titleId}>{props.title}</h2>
          <button type="button" aria-label="Close dialog" onClick={requestClose}>
            <Icon name="close" />
          </button>
        </div>
        {props.children}
      </dialog>
    </Portal>
  );
}
