import { createMemo } from 'solid-js';
import { highlightCode } from '../services/codeHighlight.js';
export default function CodeBlock(props) {
  const html = createMemo(() => highlightCode(props.code, props.language));
  return (
    <pre class="code-highlight">
      <code innerHTML={html()} />
    </pre>
  );
}
