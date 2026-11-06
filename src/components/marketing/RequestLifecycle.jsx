import { For } from 'solid-js';
import Icon from '../Icon.jsx';

export default function RequestLifecycle() {
  const steps = [
    { icon: 'chat', title: 'Ask naturally', text: '“I need access to Figma.”' },
    {
      icon: 'request',
      title: 'Collect the details',
      text: 'Choose a role and explain what you need.',
    },
    { icon: 'users', title: 'Get approval', text: 'Route the request to the right people.' },
    {
      icon: 'check',
      title: 'Follow through',
      text: 'Track the request and its fulfillment tasks.',
    },
  ];
  return (
    <div class="marketing-static-preview request-lifecycle" aria-label="Example request lifecycle">
      <For each={steps}>
        {(step, index) => (
          <article>
            <span class="marketing-diagram-icon">
              <Icon name={step.icon} />
            </span>
            <span class="marketing-diagram-number">0{index() + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>
        )}
      </For>
    </div>
  );
}
