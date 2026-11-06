import { For, Show, createResource, createSignal, createEffect } from 'solid-js';
import { api } from '../../services/api.js';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';
import { contentStatus } from '../../services/contentStatus.js';
export default function TopicArticles(props) {
  const [page, setPage] = createSignal(1),
    [rows, setRows] = createSignal([]);
  const [result] = createResource(
    () => `${props.baseId}:${props.topicId}:${page()}`,
    () =>
      api(
        `/api/helpdesk/lists/articles?list=1&base=${encodeURIComponent(props.baseId)}&topic=${encodeURIComponent(props.topicId)}&sort=Name&direction=asc&page=${page()}&pageSize=20`,
      ),
  );
  createEffect(() => {
    if (!result.error && result())
      setRows((previous) => [
        ...new Map(
          [...(page() === 1 ? [] : previous), ...(result().rows || [])].map((row) => [row.id, row]),
        ).values(),
      ]);
  });
  return (
    <div class="topic-article-list">
      <Show when={result.error}>
        <ToastMessage tone="error">{result.error.message}</ToastMessage>
      </Show>
      <For each={rows()}>
        {(article) => (
          <A class="topic-article-row" href={article.href}>
            <Icon name="book-pen" />
            <span class="topic-article-copy">
              <strong>{article.title}</strong>
              <Show when={article.description}>
                <small>{article.description.slice(0, 160)}</small>
              </Show>
            </span>
            <span
              class="activity-status"
              data-tone={contentStatus({ status: article.status }).tone}
            >
              <span class="activity-status-dot" />
              {contentStatus({ status: article.status }).label}
            </span>
            <Icon name="arrow" />
          </A>
        )}
      </For>
      <Show when={result.loading}>
        <Skeleton lines={3} label="Loading articles" />
      </Show>
      <Show when={!result.loading && !result.error && !rows().length}>
        <p class="topic-articles-empty">No articles in this topic yet.</p>
      </Show>
      <Show when={!result.error && rows().length < (result()?.total || 0)}>
        <button
          type="button"
          class="workspace-button secondary small"
          disabled={result.loading}
          onClick={() => setPage(page() + 1)}
        >
          Load More Articles
        </button>
      </Show>
    </div>
  );
}
