import { For, Switch, Match } from 'solid-js';
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
        {(step) => (
          <article>
            <div class="request-lifecycle-visual" aria-hidden="true">
              <Switch>
                <Match when={step.icon === 'chat'}>
                  <div class="lifecycle-message">I need access to Figma.</div>
                  <div class="lifecycle-response">
                    <Icon name="agent" />
                    <span>Let’s get that set up.</span>
                  </div>
                </Match>
                <Match when={step.icon === 'request'}>
                  <div class="lifecycle-form">
                    <span>Figma access</span>
                    <small>Role</small>
                    <div>
                      Editor
                      <Icon name="chevron-down" />
                    </div>
                    <small>Business reason</small>
                    <div>Design our next release</div>
                  </div>
                </Match>
                <Match when={step.icon === 'users'}>
                  <div class="lifecycle-approval">
                    <span class="lifecycle-avatar">
                      <Icon name="user" />
                    </span>
                    <span>
                      Manager approval<small>Request reviewed</small>
                    </span>
                    <Icon name="check" />
                  </div>
                  <div class="lifecycle-connector" />
                  <span class="lifecycle-success">
                    <Icon name="check" />
                    Approved
                  </span>
                </Match>
                <Match when={step.icon === 'check'}>
                  <div class="lifecycle-receipt">
                    <Icon name="check" />
                    <strong>Access granted</strong>
                    <span>Figma · Editor</span>
                  </div>
                  <div class="lifecycle-task">
                    <Icon name="check" />
                    <span>Fulfillment complete</span>
                  </div>
                </Match>
              </Switch>
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>
        )}
      </For>
    </div>
  );
}
