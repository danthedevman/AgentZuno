import { createResource, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import ArticleReader from '../../../components/knowledge/ArticleReader.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import A from '../../../components/WorkspaceLink.jsx';

export default function ArticleReadPage() {
  const params = useParams();
  const [article] = createResource(
    () => `${params.workspaceId}:${params.id}`,
    () => api(`/api/helpdesk/knowledge-center?article=${encodeURIComponent(params.id)}`),
  );
  const content = () => (article.error ? null : article());
  return (
    <section class="reading-page knowledge-center">
      <Breadcrumbs
        items={[
          { label: 'Knowledge', href: '/workspace/knowledge' },
          { label: content()?.title || 'Article' },
        ]}
      />
      <Show when={article.loading}>
        <Skeleton label="Loading article" lines={8} />
      </Show>
      <Show when={article.error}>
        <div class="empty-state">
          <h1>Article unavailable</h1>
          <p>This article may be unpublished or outside your current access.</p>
          <A href="/workspace/knowledge">Browse available knowledge</A>
        </div>
      </Show>
      <Show when={content()}>
        {(item) => (
          <article class="knowledge-center-article">
            <h1>{item().title}</h1>
            <ArticleReader articleId={item().id} body={item().body} />
          </article>
        )}
      </Show>
    </section>
  );
}
