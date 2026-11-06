import { Show, createSignal } from 'solid-js';
import { api } from '../../services/api.js';
import { displayLabel } from '../../utils/displayLabels.js';
import { useToasts } from '../../context/ToastContext.jsx';
import A from '../WorkspaceLink.jsx';

export default function RequestChatAction(props) {
  const [saving, setSaving] = createSignal(false);
  const { notify } = useToasts();
  const title = () =>
    ({
      'create-task': 'Create Task',
      'close-task': 'Close Task',
      comment: 'Add Comment',
      'work-note': 'Add Work Note',
      'assign-self': 'Assign to Me',
      update: 'Update Request',
    })[props.action.action];
  return (
    <section class="chat-request-confirmation chat-request-action" aria-label="Request action">
      <strong>
        {title()} · {props.action.number}
      </strong>
      <Show when={props.action.title}>
        <p>{props.action.title}</p>
      </Show>
      <Show when={props.action.description}>
        <p>{props.action.description}</p>
      </Show>
      <Show when={props.action.taskId}>
        <p>Task: {props.action.taskId}</p>
      </Show>
      <Show when={props.action.text}>
        <p class="request-action-text">{props.action.text}</p>
      </Show>
      <Show when={props.action.status}>
        <p>Status: {displayLabel(props.action.status)}</p>
      </Show>
      <Show when={props.action.priority}>
        <p>Priority: {displayLabel(props.action.priority)}</p>
      </Show>
      <Show
        when={props.action.state === 'pending'}
        fallback={
          <p role="status">
            {props.action.state === 'applied'
              ? 'Saved'
              : props.action.state === 'applying'
                ? 'Applying…'
                : 'Not applied. Ask Zuno to review the change again.'}
          </p>
        }
      >
        <button
          type="button"
          class="workspace-button small"
          disabled={saving() || props.disabled}
          onClick={async () => {
            setSaving(true);
            try {
              await api(`/api/helpdesk/support/conversations/${props.chatId}/actions`, {
                method: 'POST',
                body: JSON.stringify({ messageId: props.messageId }),
              });
              await props.onApplied();
              notify({ tone: 'success', message: 'Request updated.' });
            } catch (error) {
              notify({ tone: 'error', message: error.message });
              await props.onApplied();
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving() ? 'Applying…' : `Confirm ${title()}`}
        </button>
      </Show>
      <A href={`/workspace/chat/${props.chatId}?request=${props.action.requestId}`}>
        Open {props.action.number}
      </A>
    </section>
  );
}
