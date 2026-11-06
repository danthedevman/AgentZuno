import Icon from '../Icon.jsx';
import { Show, createEffect, createResource } from 'solid-js';
import { api } from '../../services/api.js';
export default function ProfileAvatar(props) {
  const [picture] = createResource(
    () => props.userId && `${props.userId}:${props.refreshKey ?? props.version ?? ''}`,
    () => api(`/api/helpdesk/profile-pictures/${props.userId}`),
  );
  createEffect(() => props.onImageChange?.(!picture.error && !!picture()?.image));
  const initial = () => {
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    return name && name !== '?' ? name.slice(0, 1).toUpperCase() : '';
  };
  return (
    <span
      class="profile-avatar"
      classList={{ 'profile-avatar-large': props.large }}
      aria-hidden="true"
    >
      <Show
        when={!picture.error && picture()?.image}
        fallback={
          <Show when={initial()} fallback={<Icon name="user" />}>
            {initial()}
          </Show>
        }
      >
        <img src={picture()?.image} alt="" />
      </Show>
    </span>
  );
}
