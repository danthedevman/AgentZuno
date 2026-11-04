import { For, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import Icon from './Icon.jsx';
export default function HeroWorkflowBackground() {
  let element;
  let transcript;
  let reducedMotion = false;
  const [stage, setStage] = createSignal(0);
  const timers = [];
  createEffect(() => {
    const current = stage();
    if (!current) return;
    requestAnimationFrame(() =>
      transcript?.scrollTo({
        top: transcript.scrollHeight,
        behavior: reducedMotion ? 'instant' : 'smooth',
      }),
    );
  });
  onMount(() => {
    const start = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        reducedMotion = true;
        setStage(11);
        return;
      }
      [100, 450, 850, 1250, 1650, 2050, 2600, 3150, 3700, 4700, 5500].forEach((delay, index) =>
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
    <div
      ref={element}
      class="hero-conversation-visual"
      classList={{ 'is-published': stage() >= 11 }}
      aria-hidden="true"
    >
      <div class="hero-ambient-glow" />
      <header>
        <span class="hero-agent-identity">
          <Icon name="agent" class="marketing-agent-mark" />
          Admin Agent
        </span>
        <span class="hero-status-indicator" />
      </header>
      <div ref={transcript} class="hero-conversation-content">
        <div
          class="hero-employee-message"
          hidden={stage() < 1}
          classList={{ 'is-visible': stage() >= 1 }}
        >
          Build a MacBook request workflow for the catalog. Ask for manager approval, open a Jira
          issue for Desktop Support, and message the user in Slack when the request is complete.
        </div>
        <div
          class="hero-agent-activity"
          hidden={stage() < 2}
          classList={{ 'is-visible': stage() >= 2 }}
        >
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
        <div
          class="hero-generated-form"
          hidden={stage() < 6}
          classList={{ 'is-visible': stage() >= 6 }}
        >
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
        <div
          class="hero-completion-flow"
          hidden={stage() < 7}
          classList={{ 'is-visible': stage() >= 7 }}
        >
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
                <div
                  class="hero-endpoint"
                  style={{ '--publish-delay': `${index() * 140}ms` }}
                  classList={{ 'is-complete': stage() >= step.stage }}
                >
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
        <div class="hero-publish-action" hidden={stage() < 9}>
          <button
            type="button"
            tabindex="-1"
            disabled
            class="hero-publish-button"
            classList={{ 'is-publishing': stage() === 10, 'is-published': stage() >= 11 }}
          >
            <Icon name={stage() >= 11 ? 'check' : stage() === 10 ? 'loading' : 'workflow'} />
            <span>
              {stage() >= 11
                ? 'Workflow Published'
                : stage() === 10
                  ? 'Publishing Workflow…'
                  : 'Publish Workflow'}
            </span>
          </button>
          <Show when={stage() >= 11}>
            <span class="hero-published-note">Ready in the Catalog</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
