import { For } from 'solid-js';
export default function Skeleton(props) {
  return (
    <div
      class={`loading-skeleton ${props.class || ''}`}
      role="status"
      aria-label={props.label || 'Loading content'}
      aria-busy="true"
    >
      <For each={Array.from({ length: props.lines || 4 }, (_, index) => index)}>
        {(index) => (
          <span
            aria-hidden="true"
            class="skeleton-line"
            style={{ width: index % 3 === 2 ? '64%' : index % 3 === 1 ? '88%' : '100%' }}
          />
        )}
      </For>
    </div>
  );
}
