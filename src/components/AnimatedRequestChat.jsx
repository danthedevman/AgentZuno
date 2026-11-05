import { repeatMarketingAnimation } from '../services/marketingAnimation.js';
import { Show, createEffect, createSignal, onMount, onCleanup } from 'solid-js';
import Icon from './Icon.jsx';
export default function AnimatedRequestChat() {
  let element;
  let messages;
  const [stage, setStage] = createSignal(0);
  const [response, setResponse] = createSignal('');
  createEffect(() => {
    stage();
    response();
    const frame = requestAnimationFrame(() => {
      if (!messages) return;
      const overflow = messages.scrollHeight - messages.clientHeight;
      if (overflow > messages.scrollTop + 2)
        messages.scrollTo({
          top: overflow,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        });
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
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
      timers.forEach(clearTimeout);
      timers.clear();
      setStage(1);
      if (reduced) {
        setResponse(message);
        setStage(8);
        return;
      }
      later(() => {
        setStage(2);
        let index = 0;
        const type = () => {
          setResponse(message.slice(0, ++index));
          if (index < message.length) later(type, 28);
          else
            later(() => {
              setStage(3);
              [450, 950, 1500, 2100, 3400].forEach((delay, index) =>
                later(() => setStage(index + 4), delay * 1.5),
              );
            }, 200);
        };
        type();
      }, 700);
    };
    onCleanup(
      repeatMarketingAnimation(
        element,
        start,
        () => {
          setStage(0);
          setResponse('');
          messages?.scrollTo({ top: 0 });
        },
        12000,
      ),
    );
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
      <div class="marketing-live-messages" ref={messages}>
        <div
          class="marketing-live-user"
          hidden={stage() < 1}
          classList={{ 'is-shown': stage() >= 1 }}
        >
          Can I get access to Figma for our design team?
        </div>
        <div
          class="marketing-live-agent"
          hidden={stage() < 2}
          classList={{ 'is-shown': stage() >= 2 }}
        >
          <Icon name="agent" class="marketing-agent-mark" />
          <p>
            {response()}
            <Show when={stage() === 2}>
              <span class="marketing-type-cursor" />
            </Show>
          </p>
        </div>
        <div
          class="marketing-live-form"
          hidden={stage() < 3}
          classList={{ 'is-shown': stage() >= 3 }}
        >
          <h3>Software Access</h3>
          <div class="marketing-demo-field">
            <span>Application</span>
            <div>
              <span classList={{ 'is-selected': stage() >= 4 }}>
                {stage() >= 4 ? 'Figma' : 'Choose Application'}
              </span>
            </div>
          </div>
          <div class="marketing-demo-field">
            <span>Access Level</span>
            <div>
              <span classList={{ 'is-selected': stage() >= 5 }}>Editor</span>
              <span>Viewer</span>
            </div>
          </div>
          <div class="marketing-demo-submit" classList={{ 'is-submitted': stage() >= 6 }}>
            {stage() >= 6 ? 'Request Submitted' : 'Submit Request'}{' '}
            <Icon name={stage() >= 6 ? 'check' : 'arrow'} />
          </div>
        </div>
        <Show when={stage() >= 7}>
          <div class="marketing-figma-processing" role="status">
            <Icon name={stage() >= 8 ? 'check' : 'loading'} />
            {stage() >= 8 ? 'Access Granted' : 'Processing your access request…'}
          </div>
        </Show>
        <Show when={stage() >= 8}>
          <div class="marketing-figma-success">
            <Icon name="agent" class="marketing-agent-mark" />
            <div>
              <p>
                You now have Editor access to Figma. You’re ready to start designing with your team.
              </p>
              <a href="https://www.figma.com/" target="_blank" rel="noopener noreferrer">
                Open Figma <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </Show>
      </div>
      <div class="marketing-live-composer">
        Message AgentZuno…<span aria-hidden="true">↑</span>
      </div>
    </div>
  );
}
