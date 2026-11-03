import { createResource, Show } from 'solid-js';
import { api } from '../services/api.js';
import Icon from './Icon.jsx';
export default function CatalogItemImage(props) {
  const [image] = createResource(
    () => props.imageId && `${props.imageId}:${props.workflowId || ''}`,
    () =>
      api(
        `/api/helpdesk/catalog-images/${props.imageId}${props.workflowId ? `?workflow=${props.workflowId}` : ''}`,
      ),
  );
  return (
    <Show when={!image.error && image()?.image} fallback={<Icon name={props.icon || 'catalog'} />}>
      <img class="catalog-item-image" src={image().image} alt="" />
    </Show>
  );
}
