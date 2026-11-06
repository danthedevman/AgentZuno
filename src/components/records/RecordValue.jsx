import { Show } from 'solid-js';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';
import ProfileAvatar from '../identity/ProfileAvatar.jsx';

const fieldIcons = {
  Status: 'task',
  'Assigned To': 'user',
  Members: 'users',
  'Assignment Group': 'users',
  'Approval Group': 'users',
  'Originating Request': 'request',
  Created: 'calendar',
  'Due Date': 'calendar',
  Active: 'check',
};

export default function RecordValue(props) {
  return (
    <dl class="record-value">
      <dt>
        <Icon name={props.icon || fieldIcons[props.label] || 'file'} />
        <span>{props.label}</span>
      </dt>
      <dd>
        <Show when={props.avatarId}>
          <ProfileAvatar userId={props.avatarId} name={props.avatarName} />
        </Show>
        <Show
          when={props.href}
          fallback={
            <Show when={props.badge} fallback={props.children || props.value || '—'}>
              <span
                class="record-status-badge"
                classList={{ 'is-complete': props.badge === 'closed' }}
              >
                {props.value}
              </span>
            </Show>
          }
        >
          <A
            class="record-value-reference"
            href={props.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>{props.value || 'Open Record'}</span>
            <Icon name="info" />
          </A>
        </Show>
      </dd>
    </dl>
  );
}
