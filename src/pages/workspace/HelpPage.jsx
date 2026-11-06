import ToastMessage from '../../components/ToastMessage.jsx';
import { createResource, For, Show } from 'solid-js';
import { api } from '../../services/api.js';
import ArticleCard from '../../components/knowledge/ArticleCard.jsx';
import PageHeading from '../../components/PageHeading.jsx';

export default function HelpPage() {
  const [explore, { refetch }] = createResource(() => api('/api/explore'));
  return (
    <>
      <PageHeading title="Help" />
      <Show when={explore.error}>
        <ToastMessage tone="error">
          Could not load guides. <button onClick={refetch}>Try again</button>
        </ToastMessage>
      </Show>
      <Show when={explore()}>
        <For each={explore()?.knowledgeBases}>
          {(base) => (
            <section class="help-section">
              <div class="section-heading">
                <div>
                  <h2>{base.name}</h2>
                  <p>{base.description}</p>
                </div>
              </div>
              <div class="article-grid">
                <For each={explore()?.articles.filter((article) => article.base === base.id)}>
                  {(article) => <ArticleCard article={article} explore />}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>
    </>
  );
}
