import { For, Show, createMemo } from 'solid-js';
import Icon from './Icon.jsx';
import { chatActivity } from '../services/chatActivity.js';
export default function AgentProgress(props) {
  const steps = createMemo(() => chatActivity(props.events, props.phase));
  const active = () => steps().at(-1);
  const completedAt = createMemo(() => {
    if (props.phase !== 'complete') return null;
    const timestamp = props.events?.filter((event) => event.phase === 'complete').at(-1)?.at;
    const date = timestamp ? new Date(timestamp) : null;
    return date && Number.isFinite(date.getTime()) ? date : null;
  });
  return (
    <div class="agent-progress">
      <details open>
        <summary>
          <span>Activity</span>
        </summary>
        <ol>
          <For each={steps().map((step) => step.phase)}>
            {(phase) => {
              const step = () => steps().find((item) => item.phase === phase);
              return (
                <li data-state={step()?.state}>
                  <span
                    classList={{
                      'activity-indicator': true,
                      'is-processing': step()?.state === 'processing',
                      'is-failed': step()?.state === 'failed',
                      'is-completed': step()?.state === 'completed',
                    }}
                    aria-hidden="true"
                  >
                    <Icon
                      name={
                        step()?.state === 'completed'
                          ? 'check'
                          : step()?.state === 'failed'
                            ? 'close'
                            : 'settings'
                      }
                    />
                  </span>
                  <span>{step()?.label}</span>
                  <small>
                    {step()?.state === 'completed'
                      ? 'Completed'
                      : step()?.state === 'failed'
                        ? 'Failed'
                        : 'Processing'}
                  </small>
                </li>
              );
            }}
          </For>
        </ol>
        <Show when={active()?.state !== 'processing'}>
          <span class="activity-current" role="status" aria-live="polite">
            <span
              classList={{
                'activity-indicator': true,
                'is-processing': active()?.state === 'processing',
                'is-failed': active()?.state === 'failed',
                'is-completed': active()?.state === 'completed',
              }}
              aria-hidden="true"
            >
              <Icon
                name={
                  active()?.state === 'completed'
                    ? 'check'
                    : active()?.state === 'failed'
                      ? 'close'
                      : 'settings'
                }
              />
            </span>
            {active()?.state === 'processing'
              ? active()?.label
              : active()?.state === 'failed'
                ? 'Failed'
                : 'Finished'}
            <Show when={completedAt()}>
              {(date) => (
                <time
                  class="activity-finished-time"
                  datetime={date().toISOString()}
                  title={date().toLocaleString()}
                >
                  {date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </time>
              )}
            </Show>
          </span>
        </Show>
      </details>
    </div>
  );
}
