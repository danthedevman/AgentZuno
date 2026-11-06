import { Show, createEffect } from 'solid-js';
import Icon from '../Icon.jsx';

export default function HeroEmployeeRequest(props) {
  let transcript;
  createEffect(() => {
    if (!props.active) return;
    props.stage;
    requestAnimationFrame(() => {
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    });
  });
  return (
    <div
      class="hero-conversation-visual hero-employee-panel"
      classList={{ 'is-front': props.active, 'is-back': !props.active }}
      aria-hidden="true"
    >
      <div class="hero-ambient-glow" />
      <header>
        <span class="hero-agent-identity">
          <Icon name="chat" />
          Zuno
        </span>
        <span>MacBook Request</span>
      </header>
      <div class="hero-request-workbench" classList={{ 'has-record': props.stage >= 9 }}>
        <div class="hero-request-chat">
          <div ref={transcript} class="hero-request-transcript">
            <Show when={props.stage >= 1}>
              <div class="hero-employee-message is-visible">I need a MacBook for my new role.</div>
            </Show>
            <Show when={props.stage >= 2}>
              <p>
                I can help with that. Complete the MacBook request below and I’ll send it to your
                manager for approval.
              </p>
            </Show>
            <Show when={props.stage >= 3}>
              <div class="hero-generated-form hero-request-form is-visible">
                <div class="hero-form-title">
                  <Icon name="request" />
                  <strong>MacBook Request</strong>
                </div>
                <div class="hero-example-field">
                  <span>Model</span>
                  <div>
                    {props.stage >= 4 ? 'MacBook Air' : 'Choose a model'}
                    <Icon name="chevron-down" />
                  </div>
                </div>
                <div class="hero-example-field">
                  <span>Accessories</span>
                  <div>
                    {props.stage >= 5 ? 'Mouse' : 'Choose accessories'}
                    <Icon name="chevron-down" />
                  </div>
                </div>
                <div class="hero-form-submit" classList={{ 'is-submitted': props.stage >= 7 }}>
                  <span>{props.stage >= 7 ? 'Request Submitted' : 'Submit Request'}</span>
                  <Icon name={props.stage >= 7 ? 'check' : 'arrow'} />
                </div>
              </div>
            </Show>
            <Show when={props.stage >= 8}>
              <p>
                Your request <strong>REQ-000001</strong> is submitted. You can follow its progress
                here.
              </p>
            </Show>
            <Show when={props.stage >= 10}>
              <p>
                Your manager approved the request. Desktop Support now has a Jira issue to prepare
                your MacBook.
              </p>
            </Show>
            <Show when={props.stage >= 11}>
              <p>Your MacBook is ready. I’ve sent the completion update to Slack.</p>
            </Show>
          </div>
          <div class="hero-example-composer">
            <span>Message Zuno</span>
            <Icon name="arrow" />
          </div>
        </div>
        <aside class="hero-request-details">
          <div class="hero-example-tabs">
            <span class="is-active">Details</span>
            <span>Attachments</span>
            <span>Tasks</span>
          </div>
          <div class="hero-example-record">
            <small>REQ-000001</small>
            <h3>MacBook Request</h3>
            <span class="hero-request-state">
              {props.stage >= 11
                ? 'Completed'
                : props.stage >= 10
                  ? 'In Progress'
                  : 'Awaiting Approval'}
            </span>
            <dl>
              <dt>Requested for</dt>
              <dd>Alex Morgan</dd>
              <dt>Model</dt>
              <dd>MacBook Air</dd>
              <dt>Accessories</dt>
              <dd>Mouse</dd>
              <dt>Assignment group</dt>
              <dd>Desktop Support</dd>
              <dt>Manager approval</dt>
              <dd>{props.stage >= 10 ? 'Approved' : 'Pending'}</dd>
            </dl>
            <Show when={props.stage >= 10}>
              <div class="hero-example-task">
                <Icon name="check" />
                <span>
                  Prepare MacBook<small>Desktop Support · Jira</small>
                </span>
              </div>
            </Show>
          </div>
        </aside>
      </div>
    </div>
  );
}
