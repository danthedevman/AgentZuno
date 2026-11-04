import Skeleton from './Skeleton.jsx';
import { For, Show, createSignal } from 'solid-js';
import Icon from './Icon.jsx';
export default function AttachmentPanel(props) {
  let picker;
  const [dragging, setDragging] = createSignal(false);
  const size = (bytes) =>
    bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return (
    <div class="attachment-panel">
      <Show when={props.onFiles}>
        <div
          class="attachment-dropzone"
          classList={{ 'is-dragging': dragging() }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!props.busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!props.busy) props.onFiles(Array.from(event.dataTransfer.files || []));
          }}
        >
          <Icon name="attachment" />
          <strong>Drop files here</strong>
          <span>Up to 10 MB per file</span>
          <input
            ref={picker}
            type="file"
            multiple
            class="sr-only"
            tabindex="-1"
            aria-label="Choose attachments"
            disabled={props.busy}
            onChange={(event) => {
              props.onFiles(Array.from(event.currentTarget.files || []));
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={props.busy}
            onClick={() => picker.click()}
          >
            {props.busy ? 'Uploading…' : 'Choose Files'}
          </button>
        </div>
      </Show>
      <Show when={props.loading && !props.files?.length}>
        <div class="attachment-list-skeleton">
          <Skeleton label="Loading attachments" lines={3} />
        </div>
      </Show>
      <Show when={!props.loading && !props.files?.length}>
        <p>No attachments.</p>
      </Show>
      <div
        class="attachment-file-list"
        classList={{ 'is-ready': !props.loading || !!props.files?.length }}
      >
        <For each={props.files || []}>
          {(file) => (
            <div class="attachment-file-row">
              <Icon name="attachment" />
              <div>
                <Show when={file.href} fallback={<strong>{file.name}</strong>}>
                  <a href={file.href} target="_blank" rel="noopener noreferrer">
                    {file.name}
                  </a>
                </Show>
                <small>{size(file.size)}</small>
              </div>
              <Show when={props.onRemove}>
                <button
                  type="button"
                  class="workspace-button secondary small"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => props.onRemove(file)}
                >
                  Remove
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
