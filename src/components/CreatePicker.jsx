import A from './WorkspaceLink.jsx';
import { For, onCleanup } from 'solid-js';
import { releaseDialog } from '../services/dialogs.js';
import Icon from './Icon.jsx';

const createOptions = [
  {
    name: 'Chat',
    icon: 'chat',
    href: '/workspace/chat',
    description: 'Start a conversation with Zuno.',
  },
  {
    name: 'Workflow',
    icon: 'workflow',
    href: '/workspace/workflows/new',
    description: 'Build a flow with the Admin agent.',
    admin: true,
  },
  {
    name: 'Data Table',
    icon: 'data',
    href: '/workspace/data/new',
    description: 'Create a reference or mapping table.',
    admin: true,
  },
  {
    name: 'Article',
    icon: 'book-pen',
    href: '/workspace/create/article',
    description: 'Write a knowledge article.',
    admin: true,
    personal: true,
  },
];

export default function CreatePicker(props) {
  let dialog;
  onCleanup(() => releaseDialog(dialog));
  return (
    <dialog
      class="create-picker"
      aria-labelledby="create-picker-title"
      ref={(element) => {
        dialog = element;
        props.dialogRef(element);
      }}
      onClose={() => {
        releaseDialog(dialog);
        props.onClose?.(dialog);
      }}
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <div class="create-picker-heading">
        <h2 id="create-picker-title">Create</h2>
        <button aria-label="Close creation picker" onClick={() => dialog.close()}>
          <Icon name="close" />
        </button>
      </div>
      <div class="create-options">
        <For
          each={createOptions.filter(
            (option) => (!option.admin || props.isAdmin) && (!option.personal || props.isPersonal),
          )}
        >
          {(option) => (
            <A href={option.href} onClick={() => dialog.close()}>
              <Icon name={option.icon} />
              <span>
                <strong>{option.name}</strong>
                <small>{option.description}</small>
              </span>
              <Icon name="arrow" />
            </A>
          )}
        </For>
      </div>
    </dialog>
  );
}
