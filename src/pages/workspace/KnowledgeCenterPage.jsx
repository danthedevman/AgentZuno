import ListPagination from '../../components/ListPagination.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import ArticleAttachments from '../../components/ArticleAttachments.jsx';
import { For, Show, createResource, createSignal, createEffect, onCleanup } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { api } from '../../services/api.js';
import ArticleEditor from '../../components/ArticleEditor.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import Icon from '../../components/Icon.jsx';
export default function KnowledgeCenterPage() {
  const { preferences, savePreferences } = useSession();
  const pageSize = () => (preferences.error ? 20 : preferences()?.listPageSize || 20);
  const [page, setPage] = createSignal(1);
  const [query, setQuery] = useSearchParams();
  const [search, setSearch] = createSignal('');
  const [applied, setApplied] = createSignal('');
  createEffect(() => {
    const text = search();
    const timer = setTimeout(() => setApplied(text), 200);
    onCleanup(() => clearTimeout(timer));
  });
  const [content] = createResource(
    () =>
      `${query.base || ''}:${query.topic || ''}:${query.article || ''}:${applied()}:${page()}:${pageSize()}`,
    () =>
      api(
        `/api/helpdesk/knowledge-center?${new URLSearchParams({ base: query.base || '', topic: query.topic || '', article: query.article || '', q: applied(), page: String(page()), pageSize: String(pageSize()) })}`,
      ),
  );
  createEffect(() => {
    query.base;
    query.topic;
    applied();
    setPage(1);
  });
  const data = () => (content.error ? null : content());
  return (
    <section class="knowledge-center reading-page">
      <header class="knowledge-center-heading">
        <h1>Knowledge Center</h1>
      </header>
      <nav aria-label="Knowledge location" class="knowledge-center-path">
        <button
          class="card-link"
          onClick={() => setQuery({ base: undefined, topic: undefined, article: undefined })}
        >
          Knowledge Bases
        </button>
        <Show when={query.base}>
          <span>/</span>
          <button
            class="card-link"
            onClick={() => setQuery({ topic: undefined, article: undefined })}
          >
            {data()?.bases?.find((item) => item.id === query.base)?.name || 'Knowledge Base'}
          </button>
        </Show>
      </nav>
      <Show when={content.error}>
        <ToastMessage tone="error">{content.error.message}</ToastMessage>
      </Show>
      <Show when={content.loading}>
        <Skeleton label="Loading knowledge" lines={4} />
      </Show>
      <Show
        when={!query.article}
        fallback={
          <Show when={data()?.body}>
            {
              <article class="knowledge-center-article">
                <h2>{data()?.title}</h2>
                <ArticleEditor readOnly content={data()?.body || ''} />
                <ArticleAttachments articleId={query.article} />
              </article>
            }
          </Show>
        }
      >
        <Show
          when={!query.base}
          fallback={
            <>
              <div class="knowledge-topic-links">
                <button
                  class="workspace-button secondary small"
                  onClick={() => setQuery({ topic: undefined })}
                >
                  All Articles
                </button>
                <For each={data()?.topics || []}>
                  {(item) => (
                    <button
                      class="workspace-button secondary small"
                      aria-pressed={query.topic === item.id}
                      onClick={() => setQuery({ topic: item.id })}
                    >
                      {item.name}
                    </button>
                  )}
                </For>
              </div>
              <Show when={data()?.articles?.total || applied()}>
                <label class="workspace-search">
                  <Icon name="search" />
                  <input
                    type="search"
                    aria-label="Search articles"
                    placeholder="Search articles…"
                    value={search()}
                    onInput={(event) => setSearch(event.currentTarget.value)}
                  />
                </label>
              </Show>
              <div class="knowledge-center-articles">
                <For each={data()?.articles?.rows || []}>
                  {(item) => (
                    <button
                      class="knowledge-center-article-link"
                      onClick={() => setQuery({ article: item.id })}
                    >
                      <strong>{item.title}</strong>
                      <Show when={item.summary}>
                        <span>{item.summary}</span>
                      </Show>
                      <Icon name="arrow" />
                    </button>
                  )}
                </For>
              </div>
              <Show when={data()?.articles?.total > 0}>
                <ListPagination
                  total={data().articles.total}
                  page={data().articles.page}
                  pageSize={data().articles.pageSize}
                  loading={content.loading}
                  onPage={setPage}
                  onPageSize={async (size) => {
                    await savePreferences({ listPageSize: size });
                    setPage(1);
                  }}
                />
              </Show>
              <Show when={!content.loading && !data()?.articles?.total}>
                <div class="record-empty-state">
                  <h3>No articles found.</h3>
                </div>
              </Show>
            </>
          }
        >
          <div class="knowledge-center-bases">
            <For each={data()?.bases || []}>
              {(item) => (
                <button
                  class="knowledge-base-card"
                  onClick={() => {
                    setSearch('');
                    setQuery({ base: item.id, topic: undefined, article: undefined });
                  }}
                >
                  <Icon name="book" />
                  <h2>{item.name}</h2>
                  <span>
                    {item.count} {item.count === 1 ? 'Article' : 'Articles'}
                  </span>
                </button>
              )}
            </For>
          </div>
          <Show when={!content.loading && !data()?.bases?.length}>
            <div class="record-empty-state">
              <h3>No knowledge available yet.</h3>
            </div>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
