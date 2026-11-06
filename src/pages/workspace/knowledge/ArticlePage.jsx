import ArticleAttachments from '../../../components/knowledge/ArticleAttachments.jsx';
import CreateArticlePage from './CreateArticlePage.jsx';
import ArticleLoading from '../../../components/knowledge/ArticleLoading.jsx';
import ArticleLayout from '../../../components/knowledge/ArticleLayout.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import { useLocation, useParams } from '@solidjs/router';
import { For, Show, createResource, createEffect } from 'solid-js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import { useSession } from '../../../context/SessionContext.jsx';
import ArticleEditor from '../../../components/knowledge/ArticleEditor.jsx';
import ArticleReadPage from './ArticleReadPage.jsx';

export default function ArticlePage() {
  const params = useParams();
  const { session } = useSession();
  const location = useLocation();
  const { workspace, access } = useWorkspace();
  const isHelp = () => location.pathname.includes('/help/');
  const [explore] = createResource(isHelp, async (enabled) =>
    enabled ? api('/api/explore') : null,
  );
  const article = () =>
    (isHelp() ? explore() : workspace())?.articles.find((article) => article.id === params.id);
  const recorded = new Set();
  createEffect(() => {
    const user = session()?.user;
    const current = article();
    if (!user || user.isDemo || isHelp() || !current || recorded.has(current.id)) return;
    recorded.add(current.id);
    api('/api/knowledge/views', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'article',
        documentId: current.id,
        eventId: crypto.randomUUID(),
      }),
    }).catch(() => {});
  });
  return (
    <Show when={isHelp() || access()?.role === 'admin'} fallback={<ArticleReadPage />}>
      <Show
        when={article()}
        fallback={
          <Show
            when={isHelp() ? !explore.loading : workspace.sectionLoaded('articles')}
            fallback={<ArticleLoading />}
          >
            <div class="empty-state">
              <h1>{explore.loading ? 'Loading article…' : 'Article unavailable'}</h1>
              <p>This article is not part of your current workspace.</p>
              <A href="/workspace/knowledge">Browse available knowledge</A>
            </div>
          </Show>
        }
      >
        {(item) => (
          <Show
            when={!isHelp() && access()?.role === 'admin' && item().body}
            fallback={
              <ArticleLayout
                article={item()}
                canEdit={access()?.role === 'admin' && !isHelp() && !!item().body}
                isPublic={isHelp() || workspace()?.mode === 'guest'}
              >
                <article class="reading-page">
                  <div class="card-meta">
                    <span>{item().label}</span>
                  </div>
                  <div class="article-title-row">
                    <h1>{item().title}</h1>
                  </div>
                  <p class="article-summary">{item().summary}</p>
                  <Show when={isHelp() || workspace()?.mode === 'guest' || !item().body}>
                    <div class="article-source">
                      <span class="status-dot" />
                      {isHelp() || workspace()?.mode === 'guest'
                        ? 'Public AgentZuno guide'
                        : 'Your account’s mock article'}
                    </div>
                  </Show>
                  <Show when={item().body}>
                    <ArticleEditor readOnly content={item().body} />
                    <ArticleAttachments articleId={item().id} />
                  </Show>
                  <For each={item().sections}>
                    {(section) => (
                      <section>
                        <h2>{section.heading}</h2>
                        <p>{section.text}</p>
                      </section>
                    )}
                  </For>
                </article>
              </ArticleLayout>
            }
          >
            <CreateArticlePage article={item()} />
          </Show>
        )}
      </Show>
    </Show>
  );
}
