import { For, Switch, Match, onMount, onCleanup } from 'solid-js';
import Icon from '../Icon.jsx';

export default function RequestLifecycle() {
  let element;
  onMount(() => {
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.IntersectionObserver
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.65 },
    );
    element.querySelectorAll('article').forEach((card) => observer.observe(card));
    onCleanup(() => observer.disconnect());
  });
  const steps = [
    {
      icon: 'chat',
      surface: 'AgentZuno',
      title: 'Ask naturally',
      text: 'Start with what you need. AgentZuno guides the conversation from there.',
      details: ['Identify the right request', 'Keep the conversation in context'],
    },
    {
      icon: 'request',
      surface: 'Figma Access Request',
      title: 'Collect the details',
      text: 'Choose a role and explain what you need.',
      details: ['Collect required information', 'Review before submitting'],
    },
    {
      icon: 'users',
      surface: 'Access workflow',
      title: 'Get approval',
      text: 'Bring in the right approver, then pass the work to your fulfillment team.',
      details: ['Approve before fulfillment', 'Give each task a clear owner'],
    },
    {
      icon: 'check',
      surface: 'Figma access',
      title: 'Follow through',
      text: 'Track the request and its fulfillment tasks.',
      details: ['Keep the request history together', 'Give the requester a clear outcome'],
    },
  ];
  return (
    <div ref={element} class="request-lifecycle" aria-label="Example request lifecycle">
      <For each={steps}>
        {(step, index) => (
          <article style={{ '--card-index': index() }}>
            <div class="request-lifecycle-visual" aria-hidden="true">
              <div class="lifecycle-app-header">
                <Icon name="agent" class="marketing-agent-mark" />
                <strong>{step.surface}</strong>
                <span class="lifecycle-window-dots">•••</span>
              </div>
              <div class="lifecycle-app-body">
                <Switch>
                  <Match when={step.icon === 'chat'}>
                    <span class="lifecycle-context">
                      <Icon name="software" />
                      Figma access request
                    </span>
                    <div class="lifecycle-message">I need access to Figma.</div>
                    <div class="lifecycle-response">
                      <Icon name="agent" />
                      <div>
                        <strong>AgentZuno</strong>
                        <span>
                          I can help with that. What role do you need, and what will you use it for?
                        </span>
                      </div>
                    </div>
                    <div class="lifecycle-message">Editor, to design our next release.</div>
                    <div class="lifecycle-composer">
                      <Icon name="plus" />
                      <span>Message AgentZuno…</span>
                      <Icon name="arrow" />
                    </div>
                  </Match>
                  <Match when={step.icon === 'request'}>
                    <div class="lifecycle-form">
                      <span class="lifecycle-form-intro">Review your request details</span>
                      <small>Requested for</small>
                      <div>
                        <Icon name="user" />
                        Alex Morgan<span class="lifecycle-self-label">You</span>
                      </div>
                      <small>Role</small>
                      <div>
                        Editor
                        <Icon name="chevron-down" />
                      </div>
                      <small>Business reason</small>
                      <div>Design our next release</div>
                      <span class="lifecycle-submit">
                        Submit Request <Icon name="arrow" />
                      </span>
                    </div>
                  </Match>
                  <Match when={step.icon === 'users'}>
                    <div class="lifecycle-workflow-trigger">
                      <Icon name="request" />
                      <span>
                        Request submitted<small>Figma · Editor access</small>
                      </span>
                      <Icon name="check" />
                    </div>
                    <div class="lifecycle-connector" />
                    <div class="lifecycle-approval">
                      <span class="lifecycle-avatar">
                        <Icon name="user" />
                      </span>
                      <span>
                        Manager approval<small>Approved by your manager</small>
                      </span>
                      <Icon name="check" />
                    </div>
                    <div class="lifecycle-connector" />
                    <div class="lifecycle-workflow-trigger lifecycle-success">
                      <Icon name="work" />
                      <span>
                        Provision access<small>Assigned to IT Support</small>
                      </span>
                      <Icon name="arrow" />
                    </div>
                    <span class="lifecycle-context">
                      <Icon name="lock" />
                      Approval required before access is granted
                    </span>
                  </Match>
                  <Match when={step.icon === 'check'}>
                    <div class="lifecycle-receipt">
                      <Icon name="check" />
                      <div>
                        <strong>Access granted</strong>
                        <span>Your Figma Editor access is ready.</span>
                      </div>
                      <span class="lifecycle-status">Resolved</span>
                    </div>
                    <dl class="lifecycle-record-fields">
                      <div>
                        <dt>Requested for</dt>
                        <dd>Alex Morgan</dd>
                      </div>
                      <div>
                        <dt>Application</dt>
                        <dd>Figma</dd>
                      </div>
                      <div>
                        <dt>Role</dt>
                        <dd>Editor</dd>
                      </div>
                    </dl>
                    <div class="lifecycle-task">
                      <Icon name="check" />
                      <span>
                        Provision Editor access<small>IT Support · Completed</small>
                      </span>
                    </div>
                    <span class="lifecycle-context">
                      <Icon name="notifications" />
                      Requester notified of completion
                    </span>
                  </Match>
                </Switch>
              </div>
            </div>
            <div class="request-lifecycle-copy">
              <span class="marketing-diagram-icon">
                <Icon name={step.icon} />
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <ul class="lifecycle-highlights">
                <For each={step.details}>
                  {(detail) => (
                    <li>
                      <Icon name="check" />
                      <span>{detail}</span>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </article>
        )}
      </For>
    </div>
  );
}
