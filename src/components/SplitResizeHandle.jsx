import { createSignal, onMount, onCleanup } from 'solid-js';
export default function SplitResizeHandle(props) {
  let handle, container;
  const [mobilePanel, setMobilePanel] = createSignal(props.initialPanel || 'left');
  function selectPanel(panel) {
    setMobilePanel(panel);
    container?.setAttribute('data-mobile-panel', panel);
  }
  const [ratio, setRatio] = createSignal(props.initialRatio || 42);
  const [bounds, setBounds] = createSignal({ minimum: 25, maximum: 70 });
  function apply(value) {
    const width = container?.getBoundingClientRect().width || 1200;
    const minimum = Math.max(
      25,
      (280 / width) * 100,
      props.maxRightWidth ? ((width - props.maxRightWidth) / width) * 100 : 0,
    );
    const maximum = Math.max(
      minimum,
      Math.min(70, ((width - (props.minRightWidth || 320)) / width) * 100),
    );
    setBounds({ minimum, maximum });
    const next = Math.max(minimum, Math.min(maximum, value));
    setRatio(next);
    container?.style.setProperty('--split-left', `${next}%`);
    try {
      localStorage.setItem(`agentzuno-split-${props.storageKey || 'chat'}`, String(next));
    } catch {}
  }
  onMount(() => {
    container = handle.parentElement;
    selectPanel(props.initialPanel || 'left');
    props.onPanelReady?.(selectPanel);
    const desktop = () => !window.matchMedia('(max-width: 900px)').matches;
    if (desktop()) apply(props.initialRatio || 42);
    const observer = new ResizeObserver(() => {
      if (desktop()) apply(ratio());
    });
    observer.observe(container);
    onCleanup(() => observer.disconnect());
    try {
      const saved = Number(localStorage.getItem(`agentzuno-split-${props.storageKey || 'chat'}`));
      if (desktop() && saved >= 25 && saved < 100) apply(saved);
    } catch {}
  });
  onCleanup(() => container?.classList.remove('is-resizing'));
  return (
    <>
      <div
        ref={handle}
        class="split-resize-handle"
        role="separator"
        aria-label={props.ariaLabel || 'Resize conversation panels'}
        aria-orientation="vertical"
        aria-valuemin={Math.round(bounds().minimum)}
        aria-valuemax={Math.round(bounds().maximum)}
        aria-valuenow={Math.round(ratio())}
        tabindex="0"
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            apply(
              event.key === 'Home'
                ? bounds().minimum
                : event.key === 'End'
                  ? bounds().maximum
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
      <div
        class="mobile-panel-switcher"
        role="group"
        aria-label={props.switcherLabel || 'Conversation view'}
      >
        <button
          type="button"
          aria-pressed={mobilePanel() === 'left'}
          onClick={() => selectPanel('left')}
        >
          {props.leftLabel || 'Chat'}
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
