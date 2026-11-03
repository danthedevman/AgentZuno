import { Show, createSignal, onMount, onCleanup } from 'solid-js';
import Icon from './Icon.jsx';
export default function AnimatedRequestChat() {
  let element;
  const [stage, setStage] = createSignal(0);
  const [response, setResponse] = createSignal('');
  const message =
    'Let’s get your Figma access request ready. Choose the access level you need, and I’ll help you send it for approval.';
  const timers = new Set();
  const later = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timers.add(timer);
  };
  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = () => {
      setStage(1);
      if (reduced) {
        setResponse(message);
        setStage(3);
        return;
      }
      later(() => {
        setStage(2);
        let index = 0;
        const type = () => {
          setResponse(message.slice(0, ++index));
          if (index < message.length) later(type, 18);
          else later(() => setStage(3), 350);
        };
        type();
      }, 700);
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
    <div ref={element} class="marketing-live-chat">
      <header>
        <span class="hero-agent-identity">
          <Icon name="agent" class="marketing-agent-mark" />
          AgentZuno
        </span>
        <span class="marketing-live-dot" />
      </header>
      <div class="marketing-live-messages">
        <div class="marketing-live-user" classList={{ 'is-shown': stage() >= 1 }}>
          Can I get access to Figma for our design team?
        </div>
        <div class="marketing-live-agent" classList={{ 'is-shown': stage() >= 2 }}>
          <Icon name="agent" class="marketing-agent-mark" />
          <p>
            {response()}
            <Show when={stage() === 2}>
              <span class="marketing-type-cursor" />
            </Show>
          </p>
        </div>
        <div class="marketing-live-form" classList={{ 'is-shown': stage() >= 3 }}>
          <h3>Software Access</h3>
          <div class="marketing-demo-field">
            <span>Application</span>
            <div>
              <span class="is-selected">Figma</span>
            </div>
          </div>
          <div class="marketing-demo-field">
            <span>Access Level</span>
            <div>
              <span class="is-selected">Editor</span>
              <span>Viewer</span>
            </div>
          </div>
          <div class="marketing-demo-submit">
            Submit Request <span aria-hidden="true">↗</span>
          </div>
        </div>
      </div>
      <div class="marketing-live-composer">
        Message AgentZuno…<span aria-hidden="true">↑</span>
      </div>
    </div>
  );
}
