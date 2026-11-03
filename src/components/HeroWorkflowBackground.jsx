import { For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import Icon from './Icon.jsx';
export default function HeroWorkflowBackground() {
  let element;
  const [stage, setStage] = createSignal(0);
  const timers = [];
  onMount(() => {
    const start = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setStage(9);
        return;
      }
      [100, 450, 850, 1250, 1650, 2050, 3250, 3950, 4700].forEach((delay, index) =>
        timers.push(setTimeout(() => setStage(index + 1), delay)),
      );
    };
    if (!window.IntersectionObserver) {
      start();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          start();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => timers.forEach(clearTimeout));
  return (
    <div ref={element} class="hero-conversation-visual" aria-hidden="true">
      <div class="hero-ambient-glow" />
      <header>
        <span class="hero-agent-identity">
          <Icon name="agent" class="marketing-agent-mark" />
          Admin Agent
        </span>
        <span class="hero-status-indicator" />
      </header>
      <div class="hero-conversation-content">
        <div class="hero-employee-message" classList={{ 'is-visible': stage() >= 1 }}>
          Build a MacBook request workflow for the catalog. Ask for manager approval, open a Jira
          issue for Desktop Support, and message the user in Slack when the request is complete.
        </div>
        <div class="hero-agent-activity" classList={{ 'is-visible': stage() >= 2 }}>
          <strong>
            {stage() >= 6 ? 'Your workflow is ready to review' : 'Building your workflow'}
          </strong>
          <ol>
            <For
              each={[
                'Designing the request form',
                'Adding manager approval',
                'Connecting Jira and Slack steps',
                'Preparing the catalog item',
              ]}
            >
              {(label, index) => (
                <li
                  classList={{
                    'is-complete': stage() >= index() + 3,
                    'is-current': stage() === index() + 2,
                  }}
                >
                  <span class="hero-step-indicator">
                    <Show when={stage() >= index() + 3} fallback={<i />}>
                      <Icon name="check" />
                    </Show>
                  </span>
                  <span>{label}</span>
                </li>
              )}
            </For>
          </ol>
        </div>
        <div class="hero-generated-form" classList={{ 'is-visible': stage() >= 6 }}>
          <div class="hero-form-title">
            <Icon name="request" />
            <strong>MacBook Request</strong>
          </div>
          <div class="hero-form-row">
            <span>Model</span>
            <div>
              <span class="is-selected">MacBook Air</span>
              <span>MacBook Pro</span>
            </div>
          </div>
          <div class="hero-form-row">
            <span>Accessories</span>
            <div>
              <span class="is-selected">Mouse</span>
              <span>Keyboard</span>
            </div>
          </div>
          <div class="hero-form-submit" classList={{ 'is-submitted': stage() >= 7 }}>
            <span>{stage() >= 7 ? 'Display in Catalog · Enabled' : 'Preparing Catalog Item'}</span>
            <Icon name={stage() >= 7 ? 'check' : 'arrow'} />
          </div>
        </div>
        <div class="hero-completion-flow" classList={{ 'is-visible': stage() >= 7 }}>
          <For
            each={[
              { title: 'Manager Approval', detail: 'Requester’s Manager', icon: 'user', stage: 7 },
              { title: 'Jira Issue', detail: 'Desktop Support', icon: 'request', stage: 8 },
              { title: 'Slack Message', detail: 'On Request Completion', icon: 'chat', stage: 9 },
            ]}
          >
            {(step, index) => (
              <>
                <Show when={index() > 0}>
                  <div
                    class="hero-endpoint-connector"
                    classList={{ 'is-complete': stage() >= step.stage }}
                  >
                    <i />
                  </div>
                </Show>
                <div class="hero-endpoint" classList={{ 'is-complete': stage() >= step.stage }}>
                  <Icon name={step.icon} />
                  <span>
                    {step.title}
                    <small>{step.detail}</small>
                  </span>
                  <Show when={stage() >= step.stage}>
                    <Icon name="check" />
                  </Show>
                </div>
              </>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
