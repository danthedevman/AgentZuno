import { onCleanup, onMount } from 'solid-js';
import Icon from '../Icon.jsx';

export default function KnowledgeEditorPanel(props) {
  let panel;
  const previousFocus = document.activeElement;
  async function close() {
    if (await props.beforeClose()) props.onClose();
  }
  onMount(() => panel.querySelector('button')?.focus());
  onCleanup(() => {
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  return (
    <aside
      class="knowledge-editor-panel"
      aria-label={props.title}
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <header class="knowledge-editor-heading">
        <h2>{props.title}</h2>
        <button
          type="button"
          class="workspace-button secondary small icon-only"
          aria-label="Close editor"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <div class="knowledge-editor-content">{props.children}</div>
    </aside>
  );
}
