import { createEffect, createSignal, Show } from 'solid-js';

export default function ContentTransition(props) {
  const [hasLoaded, setHasLoaded] = createSignal(false);
  createEffect(() => {
    if (props.ready) setHasLoaded(true);
  });
  return (
    <div class={`content-transition ${props.class || ''}`} classList={{ 'is-ready': hasLoaded() }}>
      <Show when={hasLoaded()} fallback={props.fallback}>
        {props.children}
      </Show>
    </div>
  );
}
