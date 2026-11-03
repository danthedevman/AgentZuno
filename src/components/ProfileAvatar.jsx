import { Show, createResource } from 'solid-js';
import { api } from '../services/api.js';
export default function ProfileAvatar(props) {
  const [picture] = createResource(
    () => props.userId && `${props.userId}:${props.refreshKey || ''}`,
    () => api(`/api/helpdesk/profile-pictures/${props.userId}`),
  );
  return (
    <span
      class="profile-avatar"
      classList={{ 'profile-avatar-large': props.large }}
      aria-hidden="true"
    >
      <Show
        when={!picture.error && picture()?.image}
        fallback={(props.name || '?').slice(0, 1).toUpperCase()}
      >
        <img src={picture()?.image} alt="" />
      </Show>
    </span>
  );
}
