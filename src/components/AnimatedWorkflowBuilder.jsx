import { Show, For, createSignal, onCleanup, onMount } from 'solid-js';
import Icon from './Icon.jsx';
import Dropdown from './Dropdown.jsx';

export default function AnimatedWorkflowBuilder() {
  let element;
  const [stage, setStage] = createSignal(0);
  const timers = [];
  const steps = [
    'Collect laptop and accessory choices',
    'Ask the employee’s manager to approve',
    'Create a task for Desktop Support',
  ];
  onMount(() => {
    const start = () => {
      setStage(1);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setStage(7);
      [600, 1200, 1800, 2400, 3100, 3800].forEach((delay, index) =>
        timers.push(setTimeout(() => setStage(index + 2), delay)),
      );
    };
    if (!window.IntersectionObserver) return start();
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          start();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => timers.forEach(clearTimeout));
  return (
    <div ref={element} class="marketing-builder" aria-label="Conversational workflow builder">
      <header>
        <span>Laptop Request</span>
        <span>{stage() >= 7 ? 'Draft Saved' : 'Draft'}</span>
      </header>
      <div class="marketing-builder-panes">
        <div class="marketing-builder-chat">
          <div class="marketing-builder-thread">
            <div class="marketing-live-user" classList={{ 'is-shown': stage() >= 1 }}>
              Make a laptop request with device and accessory choices, manager approval, and a task
              for Desktop Support
            </div>
            <div class="marketing-live-agent" classList={{ 'is-shown': stage() >= 2 }}>
              <Icon name="agent" class="marketing-agent-mark" />
              <p>
                {stage() >= 7
                  ? 'Your draft is ready to review. The form collects the choices, then approval comes before the support task.'
                  : 'Building the form, approval, and support task…'}
              </p>
            </div>
          </div>
          <div class="marketing-live-composer">
            Describe a change…<span aria-hidden="true">↑</span>
          </div>
        </div>
        <div class="marketing-builder-visual">
          <div class="marketing-builder-tab">Visual</div>
          <For each={steps}>
            {(step, index) => (
              <div
                class="marketing-builder-node"
                classList={{ 'is-built': stage() >= [3, 6, 7][index()] }}
              >
                <div class="marketing-builder-node-heading">
                  <span>{index() + 1}</span>
                  <p>{step}</p>
                  <Icon name="check" />
                </div>
                <Show when={index() === 0}>
                  <div class="marketing-builder-form">
                    <Show when={stage() >= 4}>
                      <div class="marketing-builder-field">
                        <span>Device</span>
                        <div class="marketing-builder-choices">
                          <span>Mac</span>
                          <span>Windows</span>
                        </div>
                      </div>
                    </Show>
                    <Show when={stage() >= 5}>
                      <div class="marketing-builder-field">
                        <span>
                          Accessories <small>Optional</small>
                        </span>
                        <div class="marketing-builder-choices">
                          <span>Mouse</span>
                          <span>Keyboard</span>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>
                <Show when={index() === 2}>
                  <div class="marketing-builder-field">
                    <span>Assignment Group</span>
                    <Dropdown
                      ariaLabel="Assignment Group"
                      readOnly
                      value="desktop"
                      options={[{ value: 'desktop', label: 'Desktop Support' }]}
                    />
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
