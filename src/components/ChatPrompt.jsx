import { useSession } from '../context/SessionContext.jsx';
import { api } from '../services/api.js';
import ChatSendButton from './ChatSendButton.jsx';
import { confirmAction } from '../services/confirmations.js';
import { For, Show, createEffect, createResource, createSignal, onMount } from 'solid-js';
import Icon from './Icon.jsx';

export default function ChatPrompt(props) {
  const { session } = useSession();
  const isDemo = () => !!session()?.user?.isInteractiveDemo;
  const [promptsOpen, setPromptsOpen] = createSignal(
    (() => {
      try {
        return sessionStorage.getItem('agentzuno-demo-prompts-open') !== 'false';
      } catch {
        return true;
      }
    })(),
  );
  function togglePrompts(open) {
    setPromptsOpen(open);
    if (isDemo()) {
      try {
        sessionStorage.setItem('agentzuno-demo-prompts-open', String(open));
      } catch {}
    }
  }
  const [demo] = createResource(isDemo, () => api('/api/demo'));
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
    <>
      <form
        novalidate
        class={`chat-prompt${isDemo() ? ' is-demo-readonly' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (isReady()) {
            togglePrompts(false);
            props.onSubmit(event);
          }
        }}
        aria-label="Send a chat message"
      >
        <Show when={isDemo() && !demo.error && demo()}>
          <details
            class="demo-prompt-picker"
            open={promptsOpen()}
            onToggle={(event) => togglePrompts(event.currentTarget.open)}
          >
            <summary>Suggested Prompts</summary>
            <div class="demo-prompt-options" aria-label="Predefined demo prompts">
              <For each={demo().prompts}>
                {(prompt) => (
                  <button
                    type="button"
                    class="workspace-button secondary small"
                    disabled={props.disabled}
                    onClick={() => props.onInput?.(prompt.prompt)}
                  >
                    {prompt.prompt}
                  </button>
                )}
              </For>
            </div>
          </details>
        </Show>
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
            disabled={
              isDemo() || props.disabled || props.uploading || props.attachments?.length >= 5
            }
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
          placeholder={
            isDemo() ? 'Choose a suggested prompt' : props.placeholder || 'Ask me anything'
          }
          rows="3"
          maxlength="7000"
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          readOnly={props.readOnly || isDemo()}
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
    </>
  );
}
