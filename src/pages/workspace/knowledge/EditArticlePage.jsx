import ArticleLoading from '../../../components/knowledge/ArticleLoading.jsx';
import { useParams } from '@solidjs/router';
import { Show } from 'solid-js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import CreateArticlePage from './CreateArticlePage.jsx';
import A from '../../../components/WorkspaceLink.jsx';

export default function EditArticlePage() {
  const params = useParams();
  const { workspace } = useWorkspace();
  const article = () => workspace()?.articles.find((item) => item.id === params.id && item.body);
  return (
    <Show
      when={article()}
      keyed
      fallback={
        <Show when={workspace.sectionLoaded('articles')} fallback={<ArticleLoading />}>
          <section class="reading-page">
            <h1>Article unavailable</h1>
            <p>This article cannot be edited in your workspace.</p>
            <A href="/workspace/knowledge">Back to knowledge</A>
          </section>
        </Show>
      }
    >
      {(item) => <CreateArticlePage article={item} />}
    </Show>
  );
}
