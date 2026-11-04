import { Index, Show } from 'solid-js';
import A from './WorkspaceLink.jsx';

export default function Breadcrumbs(props) {
  return (
    <nav class={`breadcrumbs ${props.class || ''}`} aria-label={props.label || 'Page location'}>
      <ol>
        <Index each={props.items.filter(Boolean)}>
          {(item, index) => (
            <li>
              <Show
                when={
                  item().href && (props.children || index < props.items.filter(Boolean).length - 1)
                }
                fallback={<div aria-current="page">{item().content || item().label}</div>}
              >
                <A href={item().href}>{item().label}</A>
              </Show>
            </li>
          )}
        </Index>
        <Show when={props.children}>
          <li>
            <div aria-current="page">{props.children}</div>
          </li>
        </Show>
      </ol>
    </nav>
  );
}
