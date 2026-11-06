import { Show, createResource } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import CreateTopicPage from './CreateTopicPage.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
export default function TopicPage() {
  const params = useParams();
  const [topic] = createResource(
    () => params.topicId,
    (id) => api(`/api/records/topic/${id}`),
  );
  return (
    <Show
      when={!topic.error}
      fallback={<ToastMessage tone="error">{topic.error?.message}</ToastMessage>}
    >
      <Show when={topic()} keyed fallback={<Skeleton label="Loading topic" />}>
        {(record) => <CreateTopicPage topic={record} />}
      </Show>
    </Show>
  );
}
