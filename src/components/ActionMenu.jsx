import { For, Show, createSignal, createUniqueId, onMount, onCleanup } from 'solid-js';
import Icon from './Icon.jsx';
import A from './WorkspaceLink.jsx';

export default function ActionMenu(props) {
  const [open, setOpen] = createSignal(false);
  const id = createUniqueId();
  let root, trigger, menu;
  function close() {
    setOpen(false);
  }
  function focus(index) {
    const buttons = menu?.querySelectorAll('[role="menuitem"]');
    buttons?.[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  }
  function keyboard(event) {
    const buttons = [...(menu?.querySelectorAll('[role="menuitem"]') || [])];
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      trigger?.focus();
    } else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      focus(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length,
      );
    }
  }
  onMount(() => {
    const outside = (event) => {
      if (!root?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    onCleanup(() => document.removeEventListener('pointerdown', outside));
  });
  return (
    <div class="list-action-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        class="workspace-button secondary small icon-only"
        aria-label={props.label || 'More actions'}
        title={props.label || 'More actions'}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={id}
        disabled={props.disabled}
        onClick={() => setOpen(!open())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
            queueMicrotask(() => focus(event.key === 'ArrowDown' ? 0 : props.items.length - 1));
          } else if (event.key === 'Escape') close();
        }}
      >
        <Icon name="more" />
      </button>
      <Show when={open()}>
        <div
          ref={menu}
          id={id}
          class="list-action-options"
          role="menu"
          aria-label={props.label || 'More actions'}
          onKeyDown={keyboard}
        >
          <For each={props.items}>
            {(item) => (
              <Show
                when={item.href}
                fallback={
                  <button
                    role="menuitem"
                    type="button"
                    disabled={item.disabled}
                    onClick={() => {
                      close();
                      item.onClick?.();
                    }}
                  >
                    {item.label}
                  </button>
                }
              >
                <A role="menuitem" href={item.href} onClick={close}>
                  {item.label}
                </A>
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
