import { For } from 'solid-js';
import Icon from '../Icon.jsx';

export default function WorkflowDiagram() {
  const steps = [
    {
      icon: 'request',
      title: 'Collect request details',
      text: 'Laptop model, accessories, and business reason',
    },
    {
      icon: 'users',
      title: 'Request manager approval',
      text: 'Wait for an authorized approval decision',
    },
    {
      icon: 'work',
      title: 'Create a fulfillment task',
      text: 'Assign Desktop Support to prepare the device',
    },
    {
      icon: 'check',
      title: 'Complete the request',
      text: 'Record the outcome and notify the requester',
    },
  ];
  return (
    <div
      class="marketing-static-preview marketing-workflow-diagram"
      aria-label="Example laptop request workflow"
    >
      <header>
        <Icon name="workflow" />
        <strong>Laptop Request</strong>
        <span>Example workflow</span>
      </header>
      <ol>
        <For each={steps}>
          {(step) => (
            <li>
              <span class="marketing-diagram-icon">
                <Icon name={step.icon} />
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}
