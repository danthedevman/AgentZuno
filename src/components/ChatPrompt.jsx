import ChatSendButton from './ChatSendButton.jsx';
import { confirmAction } from '../services/confirmations.js';
import { For, Show, createEffect, onMount } from 'solid-js';
import Icon from './Icon.jsx';

export default function ChatPrompt(props) {
  let fileInput;
  let messageInput;
  let hasFocused = false;
  onMount(() =>
    createEffect(() => {
      if (props.autoFocus && !props.readOnly && !hasFocused) {
        hasFocused = true;
        messageInput.focus({ preventScroll: true });
      }
    }),
  );
  const isReady = () =>
    !props.disabled &&
    !props.uploading &&
    (!!props.value?.trim() || !!props.attachments?.length) &&
    props.value.length <= 7000;
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (isReady()) event.currentTarget.form.requestSubmit();
    }
  }
  return (
    <form
      novalidate
      class="chat-prompt"
      onSubmit={(event) => {
        event.preventDefault();
        if (isReady()) props.onSubmit(event);
      }}
      aria-label="Send a chat message"
    >
      <Show when={props.onFiles}>
        <input
          ref={fileInput}
          class="sr-only"
          type="file"
          multiple
          accept=".txt,.md,.csv,.json,.log"
          tabindex="-1"
          aria-label="Attach text files"
          onChange={(event) => {
            props.onFiles(Array.from(event.currentTarget.files || []));
            event.currentTarget.value = '';
          }}
        />
        <button
          class="chat-attach-button"
          type="button"
          aria-label="Attach files"
          title="Attach TXT, Markdown, CSV, JSON, or LOG files (up to 100 KB each)"
          disabled={props.disabled || props.uploading || props.attachments?.length >= 5}
          onClick={() => fileInput.click()}
        >
          <Icon name="attachment" />
        </button>
      </Show>
      <label class="sr-only" for="chat-message">
        Message
      </label>
      <textarea
        ref={messageInput}
        id="chat-message"
        name="message"
        placeholder={props.placeholder || 'Ask me anything'}
        rows="3"
        maxlength="7000"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        readOnly={props.readOnly}
      />
      <div class="prompt-toolbar">
        <ChatSendButton disabled={!isReady()} />
      </div>
      <Show when={props.attachments?.length || props.uploading}>
        <div class="chat-attachments" aria-label="Attached files">
          <For each={props.attachments || []}>
            {(file) => (
              <span class="chat-file-chip">
                <Icon name="file" />
                <span>{file.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={props.disabled}
                  onClick={async () => {
                    if (await confirmAction(`Remove “${file.name}” from this message?`))
                      props.onRemoveFile(file.id);
                  }}
                >
                  <Icon name="close" />
                </button>
              </span>
            )}
          </For>
          <Show when={props.uploading}>
            <span role="status">{props.uploadStatus || 'Uploading…'}</span>
          </Show>
        </div>
      </Show>
    </form>
  );
}
