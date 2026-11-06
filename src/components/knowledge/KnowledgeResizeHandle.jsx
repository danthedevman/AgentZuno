import { createSignal, onMount, onCleanup } from 'solid-js';

export default function KnowledgeResizeHandle(props) {
  let handle;
  const [width, setWidth] = createSignal(280);
  const [maximum, setMaximum] = createSignal(420);
  const max = () => Math.max(220, Math.min(420, (handle?.parentElement.clientWidth || 900) - 360));
  function apply(value) {
    const limit = max();
    setMaximum(limit);
    const next = Math.round(Math.max(220, Math.min(limit, value)));
    setWidth(next);
    handle.parentElement.style.setProperty('--knowledge-sidebar-width', `${next}px`);
    try {
      localStorage.setItem(props.storageKey, String(next));
    } catch {}
  }
  onMount(() => {
    let initial = 280;
    try {
      const saved = Number(localStorage.getItem(props.storageKey));
      if (saved >= 220 && saved <= 420) initial = saved;
    } catch {}
    apply(initial);
    const observer = new ResizeObserver(() => {
      if (handle.parentElement.clientWidth > 700) apply(width());
    });
    observer.observe(handle.parentElement);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={handle}
      class="knowledge-resize-handle"
      role="separator"
      tabindex="0"
      aria-label="Resize knowledge folders"
      aria-orientation="vertical"
      aria-valuemin="220"
      aria-valuemax={maximum()}
      aria-valuenow={width()}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        apply(
          event.key === 'Home'
            ? 220
            : event.key === 'End'
              ? max()
              : width() + (event.key === 'ArrowRight' ? 16 : -16),
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (handle.hasPointerCapture(event.pointerId))
          apply(event.clientX - handle.parentElement.getBoundingClientRect().left);
      }}
      onPointerUp={(event) => {
        if (handle.hasPointerCapture(event.pointerId))
          handle.releasePointerCapture(event.pointerId);
      }}
    />
  );
}
