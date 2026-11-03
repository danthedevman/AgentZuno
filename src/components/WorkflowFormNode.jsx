import { createSignal, Show } from 'solid-js';
import RequestForm from './RequestForm.jsx';

export default function WorkflowFormNode(props) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <li class="workflow-node workflow-form-node">
      <details open onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <span>Request Form</span>
          <small>{props.form.fields.length} Fields</small>
        </summary>
        <Show when={expanded()}>
          <div class="workflow-form-node-preview">
            <RequestForm preview form={props.form} identity={props.form.title} />
          </div>
        </Show>
      </details>
    </li>
  );
}
