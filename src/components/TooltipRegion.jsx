import { Show, createSignal, createUniqueId, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';

export default function TooltipRegion(props) {
  const [tooltip, setTooltip] = createSignal(null);
  const id = createUniqueId();
  let region;
  let anchor;
  function hide() {
    if (anchor) {
      const describedBy = (anchor.getAttribute('aria-describedby') || '')
        .split(' ')
        .filter((value) => value && value !== id);
      if (describedBy.length) anchor.setAttribute('aria-describedby', describedBy.join(' '));
      else anchor.removeAttribute('aria-describedby');
    }
    anchor = null;
    setTooltip(null);
  }
  function show(event) {
    if (event.pointerType === 'touch') return;
    const target = event.target.closest?.('[data-tooltip]');
    if (!target || !region.contains(target) || target.disabled) return;
    hide();
    anchor = target;
    anchor.setAttribute(
      'aria-describedby',
      [anchor.getAttribute('aria-describedby'), id].filter(Boolean).join(' '),
    );
    const bounds = target.getBoundingClientRect();
    const theme = getComputedStyle(target);
    const above = bounds.bottom + 64 > window.innerHeight;
    setTooltip({
      label: target.dataset.tooltip,
      style: {
        left: `${Math.max(8, Math.min(bounds.left, window.innerWidth - 268))}px`,
        top: `${above ? bounds.top - 8 : bounds.bottom + 8}px`,
        transform: above ? 'translateY(-100%)' : 'none',
        background: theme.getPropertyValue('--workspace-panel'),
        color: theme.getPropertyValue('--workspace-ink'),
        'border-color': theme.getPropertyValue('--workspace-line'),
      },
    });
  }
  function leave(event) {
    if (!anchor?.contains(event.relatedTarget)) hide();
  }
  onMount(() => {
    const dismiss = (event) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', dismiss);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    onCleanup(() => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      hide();
    });
  });
  return (
    <div
      ref={region}
      class="tooltip-region"
      onPointerOver={show}
      onPointerOut={leave}
      onFocusIn={show}
      onFocusOut={leave}
      onClick={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {props.children}
      <Show when={tooltip()}>
        {(item) => (
          <Portal>
            <span id={id} role="tooltip" class="control-tooltip" style={item().style}>
              {item().label}
            </span>
          </Portal>
        )}
      </Show>
    </div>
  );
}
