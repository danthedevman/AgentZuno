import { createResource, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import ArticleReader from '../../../components/knowledge/ArticleReader.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';

export default function ArticleReadPage() {
  const params = useParams();
  const { access, workspace } = useWorkspace();
  const [article] = createResource(
    () => `${params.workspaceId}:${params.id}`,
    () => api(`/api/helpdesk/knowledge-center?article=${encodeURIComponent(params.id)}`),
  );
  const content = () =>
    access()?.role === 'admin'
      ? workspace()?.articles?.find((item) => item.id === params.id) ||
        (article.error ? null : article())
      : article.error
        ? null
        : article();
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
      <Show when={article.error && !content()}>
        <div class="empty-state">
          <h1>Article unavailable</h1>
          <p>This article may be unpublished or outside your current access.</p>
          <A href="/workspace/knowledge">Browse available knowledge</A>
        </div>
      </Show>
      <Show when={content()}>
        {(item) => (
          <article class="knowledge-center-article">
            <RecordHeader title={item().title}>
              <Show when={access()?.role === 'admin' && item().body}>
                <A class="workspace-button small" href={`/workspace/articles/${item().id}/edit`}>
                  Edit Article
                </A>
              </Show>
            </RecordHeader>
            <ArticleReader articleId={item().id} body={item().body} />
          </article>
        )}
      </Show>
    </section>
  );
}
