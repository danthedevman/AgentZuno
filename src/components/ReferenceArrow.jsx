import { Show } from 'solid-js';
import Icon from './Icon.jsx';
import { useWorkspacePath } from '../services/workspaceRoutes.js';
export default function ReferenceArrow(props) {
  const path = useWorkspacePath();
  const href = () =>
    typeof props.href === 'string' && /^\/workspace\//.test(props.href) ? path(props.href) : '';
  return (
    <Show when={href()}>
      <a
        class="reference-open-link"
        href={href()}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${props.label || 'referenced record'} in a new tab`}
        title="Open referenced record in a new tab"
        onClick={(event) => event.stopPropagation()}
      >
        <Icon name="info" />
      </a>
    </Show>
  );
}
