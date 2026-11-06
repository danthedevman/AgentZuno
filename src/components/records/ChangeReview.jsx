import { For, createMemo } from 'solid-js';
import { changedSections, diffLines } from '../../utils/textDiff.js';

export default function ChangeReview(props) {
  const sections = createMemo(() => changedSections(props.sections || []));
  return (
    <section class="change-review" aria-label="Proposed changes">
      <h2>Changes to review</h2>
      <p>
        {sections().length} changed {sections().length === 1 ? 'section' : 'sections'}. Removed
        lines use −; added lines use +.
      </p>
      <For each={sections()}>
        {(section) => (
          <details open class="change-review-section">
            <summary>
              {section.label}
              <span>Changed</span>
            </summary>
            <div
              class="change-review-lines"
              role="region"
              aria-label={`${section.label} diff`}
              tabindex="0"
            >
              <For each={diffLines(section.before, section.after)}>
                {(line) => (
                  <div class={`change-review-line is-${line.type}`}>
                    <span class="diff-line-number" aria-hidden="true">
                      {line.oldLine ?? ''}
                    </span>
                    <span class="diff-line-number" aria-hidden="true">
                      {line.newLine ?? ''}
                    </span>
                    <span class="diff-line-sign">
                      {line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}
                    </span>
                    <code>{line.text || ' '}</code>
                  </div>
                )}
              </For>
            </div>
          </details>
        )}
      </For>
    </section>
  );
}
