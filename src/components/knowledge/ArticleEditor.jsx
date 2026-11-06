import ToastMessage from '../ToastMessage.jsx';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { For, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { api } from '../../services/api.js';
import Icon from '../Icon.jsx';

export default function ArticleEditor(props) {
  let element;
  let fileInput;
  let editor;
  const [revision, setRevision] = createSignal(0);
  const [isUploading, setIsUploading] = createSignal(false);
  const [error, setError] = createSignal('');
  const tools = [
    { label: 'Bold', mark: 'bold', run: (chain) => chain.toggleBold() },
    { label: 'Italic', mark: 'italic', run: (chain) => chain.toggleItalic() },
    { label: 'Heading', mark: 'heading', run: (chain) => chain.toggleHeading({ level: 2 }) },
    { label: 'Bullet list', mark: 'bulletList', run: (chain) => chain.toggleBulletList() },
    { label: 'Numbered list', mark: 'orderedList', run: (chain) => chain.toggleOrderedList() },
    { label: 'Quote', mark: 'blockquote', run: (chain) => chain.toggleBlockquote() },
  ];

  async function uploadImage(file) {
    if (isUploading()) return;
    setError('');
    if (!props.canUpload) return setError('Sign in to upload images to your workspace.');
    if (
      !file.size ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      return setError('Choose a PNG, JPEG, WebP, or GIF under 5 MB.');
    setIsUploading(true);
    props.onUploading?.(true);
    try {
      const image = await api('/api/uploads/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!editor.isDestroyed)
        editor.chain().focus().setImage({ src: image.src, alt: file.name }).run();
    } catch (error) {
      setError(error.message);
    } finally {
      setIsUploading(false);
      props.onUploading?.(false);
    }
  }

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), Image],
      content: props.content || '',
      editable: !props.readOnly,
      editorProps: {
        attributes: {
          role: props.readOnly ? 'document' : 'textbox',
          'aria-label': 'Body',
          'aria-multiline': 'true',
          ...(!props.readOnly
            ? { 'data-validation-field': '', 'data-required': 'true', 'data-max-length': '200000' }
            : {}),
          class: 'article-editor-content',
        },
        handlePaste: (view, event) => {
          if (props.readOnly) return false;
          const file = [...(event.clipboardData?.files || [])].find((file) =>
            file.type.startsWith('image/'),
          );
          if (!file) return false;
          uploadImage(file);
          return true;
        },
        handleDrop: (view, event, slice, moved) => {
          if (props.readOnly || moved) return false;
          const file = event.dataTransfer?.files[0];
          if (!file) return false;
          event.preventDefault();
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (position) editor.commands.setTextSelection(position.pos);
          uploadImage(file);
          return true;
        },
      },
      onUpdate: ({ editor }) => {
        editor.view.dom.dataset.validationValue = editor.isEmpty ? '' : editor.getHTML();
        props.onChange?.({ html: editor.getHTML(), isEmpty: editor.isEmpty });
      },
      onTransaction: () => setRevision((value) => value + 1),
    });
    editor.view.dom.dataset.validationValue = editor.isEmpty ? '' : editor.getHTML();
    createEffect(() => {
      const next = props.content || '';
      if (props.readOnly && !editor.isDestroyed && editor.getHTML() !== next)
        editor.commands.setContent(next, { emitUpdate: false });
    });
    onCleanup(() => editor.destroy());
  });

  return (
    <div classList={{ 'article-editor': !props.readOnly, 'article-body': props.readOnly }}>
      <Show when={!props.readOnly}>
        <div class="editor-toolbar" role="toolbar" aria-label="Body formatting">
          <For each={tools}>
            {(tool) => (
              <button
                type="button"
                aria-pressed={(revision(), editor?.isActive(tool.mark) || false)}
                onClick={() => tool.run(editor.chain().focus()).run()}
              >
                {tool.label}
              </button>
            )}
          </For>
          <button
            type="button"
            aria-label="Undo"
            onClick={() => editor.chain().focus().undo().run()}
          >
            Undo
          </button>
          <button
            type="button"
            aria-label="Redo"
            onClick={() => editor.chain().focus().redo().run()}
          >
            Redo
          </button>
          <button type="button" disabled={isUploading()} onClick={() => fileInput.click()}>
            <Icon name="image" />
            {isUploading() ? 'Uploading…' : 'Image'}
          </button>
          <input
            ref={fileInput}
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="Upload image"
            onChange={(event) => {
              const file = event.currentTarget.files[0];
              if (file) uploadImage(file);
              event.currentTarget.value = '';
            }}
          />
        </div>
      </Show>
      <div ref={element} />
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
    </div>
  );
}
