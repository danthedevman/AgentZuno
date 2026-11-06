import { createSignal, onMount, onCleanup } from 'solid-js';
export default function SplitResizeHandle(props) {
  let handle, container;
  const [mobilePanel, setMobilePanel] = createSignal('left');
  function selectPanel(panel) {
    setMobilePanel(panel);
    container?.setAttribute('data-mobile-panel', panel);
  }
  const [ratio, setRatio] = createSignal(42);
  function apply(value) {
    const width = container?.getBoundingClientRect().width || 1200;
    const minimum = Math.max(25, (280 / width) * 100);
    const maximum = Math.max(minimum, Math.min(70, ((width - 320) / width) * 100));
    const next = Math.max(minimum, Math.min(maximum, value));
    setRatio(next);
    container?.style.setProperty('--split-left', `${next}%`);
    try {
      localStorage.setItem(`agentzuno-split-${props.storageKey || 'chat'}`, String(next));
    } catch {}
  }
  onMount(() => {
    container = handle.parentElement;
    selectPanel('left');
    props.onPanelReady?.(selectPanel);
    if (window.matchMedia('(max-width: 900px)').matches) return;
    try {
      const saved = Number(localStorage.getItem(`agentzuno-split-${props.storageKey || 'chat'}`));
      if (saved >= 25 && saved <= 70) apply(saved);
    } catch {}
  });
  onCleanup(() => container?.classList.remove('is-resizing'));
  return (
    <>
      <div
        ref={handle}
        class="split-resize-handle"
        role="separator"
        aria-label="Resize conversation panels"
        aria-orientation="vertical"
        aria-valuemin="25"
        aria-valuemax="70"
        aria-valuenow={Math.round(ratio())}
        tabindex="0"
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            apply(
              event.key === 'Home'
                ? 25
                : event.key === 'End'
                  ? 70
                  : ratio() + (event.key === 'ArrowRight' ? 2 : -2),
            );
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          handle.setPointerCapture(event.pointerId);
          container.classList.add('is-resizing');
        }}
        onPointerMove={(event) => {
          if (!handle.hasPointerCapture(event.pointerId)) return;
          const rect = container.getBoundingClientRect();
          const min = (280 / rect.width) * 100,
            max = ((rect.width - 320) / rect.width) * 100;
          apply(Math.max(min, Math.min(max, ((event.clientX - rect.left) / rect.width) * 100)));
        }}
        onPointerUp={(event) => {
          if (handle.hasPointerCapture(event.pointerId))
            handle.releasePointerCapture(event.pointerId);
          container.classList.remove('is-resizing');
        }}
        onLostPointerCapture={() => container?.classList.remove('is-resizing')}
      />
      <div class="mobile-panel-switcher" role="group" aria-label="Conversation view">
        <button
          type="button"
          aria-pressed={mobilePanel() === 'left'}
          onClick={() => selectPanel('left')}
        >
          Chat
        </button>
        <button
          type="button"
          aria-pressed={mobilePanel() === 'right'}
          onClick={() => selectPanel('right')}
        >
          {props.rightLabel || 'Details'}
        </button>
      </div>
    </>
  );
}
