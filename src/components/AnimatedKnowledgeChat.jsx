import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import Icon from './Icon.jsx';

export default function AnimatedKnowledgeChat() {
  let element;
  const [stage, setStage] = createSignal(0);
  const [isArticleOpen, setArticleOpen] = createSignal(false);
  const timers = [];
  onMount(() => {
    const start = () => {
      setStage(1);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setStage(4);
        return;
      }
      [650, 1550, 2300].forEach((delay, index) =>
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
    <div
      ref={element}
      class="marketing-live-chat marketing-knowledge-chat"
      aria-label="Knowledge article conversation"
    >
      <header>
        <span class="hero-agent-identity">
          <Icon name="agent" class="marketing-agent-mark" />
          AgentZuno
        </span>
        <span class="marketing-live-dot" />
      </header>
      <div class="marketing-live-messages">
        <Show when={stage() >= 1}>
          <div class="marketing-live-user is-shown">How do I connect to the office Wi-Fi?</div>
        </Show>
        <Show when={stage() >= 2}>
          <div class="marketing-live-agent is-shown">
            <Icon name="agent" class="marketing-agent-mark" />
            <p>
              {stage() < 3
                ? 'Finding the right article…'
                : 'Choose Company Wi-Fi and sign in with your work account. Here’s the guide with the steps for your device.'}
            </p>
          </div>
        </Show>
        <Show when={stage() >= 4}>
          <article class="marketing-answer-article">
            <small>IT Support / Getting Connected</small>
            <h3>Connect to office Wi-Fi</h3>
            <p>Get online with your work account on Mac, Windows, or your phone</p>
            <button
              type="button"
              aria-expanded={isArticleOpen()}
              onClick={() => setArticleOpen(!isArticleOpen())}
            >
              {isArticleOpen() ? 'Close article' : 'Read article'} <span aria-hidden="true">→</span>
            </button>
            <Show when={isArticleOpen()}>
              <ol>
                <li>Open your device’s Wi-Fi settings</li>
                <li>Select Company Wi-Fi</li>
                <li>Sign in with your work account and approve the sign-in prompt</li>
              </ol>
            </Show>
          </article>
        </Show>
      </div>
      <div class="marketing-live-composer">
        Message AgentZuno…<span aria-hidden="true">↑</span>
      </div>
    </div>
  );
}
