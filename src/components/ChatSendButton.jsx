import Icon from './Icon.jsx';
export default function ChatSendButton(props) {
  return (
    <button
      class="prompt-submit"
      type="submit"
      aria-label="Send message"
      title="Send message"
      disabled={props.disabled}
    >
      <Icon name="arrow" />
    </button>
  );
}
