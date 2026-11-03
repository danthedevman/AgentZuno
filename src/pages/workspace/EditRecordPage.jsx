import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import { useParams } from '@solidjs/router';
import { Show, createResource } from 'solid-js';
import { api } from '../../services/api.js';
import CreatePage from './CreatePage.jsx';
import CreateTopicPage from './CreateTopicPage.jsx';

export default function EditRecordPage() {
  const params = useParams();
  const [record] = createResource(
    () => `${params.type}:${params.id}`,
    async () => api(`/api/records/${params.type}/${params.id}`),
  );
  return (
    <Show
      when={!record.error}
      fallback={
        <ToastMessage tone="error">
          This record is not available to edit in your workspace.
        </ToastMessage>
      }
    >
      <Show when={record()} keyed fallback={<Skeleton label="Loading record" lines={6} />}>
        {(item) =>
          item.type === 'topic' ? <CreateTopicPage topic={item} /> : <CreatePage record={item} />
        }
      </Show>
    </Show>
  );
}
