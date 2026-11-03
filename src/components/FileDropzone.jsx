import ToastMessage from './ToastMessage.jsx';
import { Show, createSignal } from 'solid-js';
import Icon from './Icon.jsx';

export default function FileDropzone(props) {
  let input;
  const [file, setFile] = createSignal(null);
  const [isDragging, setIsDragging] = createSignal(false);
  const [error, setError] = createSignal('');

  function selectFile(selected) {
    setError('');
    if (selected && (!selected.size || selected.size > 5 * 1024 * 1024)) {
      input.value = '';
      setFile(null);
      setError('Choose a non-empty file under 5 MB.');
      return;
    }
    setFile(selected || null);
  }

  return (
    <div class="file-upload-field">
      <span id="file-upload-label">File</span>
      <div
        classList={{ 'file-dropzone': true, 'is-dragging': isDragging() }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const selected = event.dataTransfer.files[0];
          if (!selected) return;
          const files = new DataTransfer();
          files.items.add(selected);
          input.files = files.files;
          selectFile(selected);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }}
      >
        <input
          ref={input}
          type="file"
          name="file"
          required={props.required ?? true}
          aria-labelledby="file-upload-label"
          aria-describedby="file-upload-hint"
          onChange={(event) => selectFile(event.currentTarget.files[0])}
        />
        <span class="file-dropzone-icon">
          <Icon name={file() ? 'file' : 'upload'} />
        </span>
        <strong>{file()?.name || 'Click to choose a file'}</strong>
        <span>
          {file()
            ? `${Math.max(1, Math.round(file().size / 1024))} KB · Click or drop to replace`
            : 'or drag and drop it here'}
        </span>
        <small id="file-upload-hint">Up to 5 MB</small>
      </div>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
    </div>
  );
}
