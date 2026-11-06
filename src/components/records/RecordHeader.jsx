import { Show } from 'solid-js';
import PageHeading from '../PageHeading.jsx';

export default function RecordHeader(props) {
  return (
    <div class="record-page-heading">
      <div class="record-page-title">
        <PageHeading title={props.title} />
        <Show when={props.context}>
          <p>{props.context}</p>
        </Show>
      </div>
      <div class="helpdesk-actions">{props.children}</div>
    </div>
  );
}
