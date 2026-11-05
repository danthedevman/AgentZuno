import { Show } from 'solid-js';
import Icon from './Icon.jsx';

export default function ChatPanelToolbar(props) {
  return (
    <header class="chat-panel-toolbar">
      <Show when={props.title}>
        <h1>{props.title}</h1>
      </Show>
      <button type="button" disabled={props.disabled} onClick={props.onNewChat}>
        <Icon name="add" />
        New Chat
      </button>
    </header>
  );
}
