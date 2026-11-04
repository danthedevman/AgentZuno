import Skeleton from './Skeleton.jsx';
import A from './WorkspaceLink.jsx';
import {
  For,
  Show,
  createMemo,
  createSignal,
  createResource,
  createEffect,
  onMount,
  onCleanup,
} from 'solid-js';
import { releaseDialog } from '../services/dialogs.js';
import { api } from '../services/api.js';
import { useSession } from '../context/SessionContext.jsx';
import Icon from './Icon.jsx';

export default function SearchOverlay(props) {
  let dialog;
  let resultsElement;
  const [hasMore, setHasMore] = createSignal(false);
  function updateOverflow() {
    if (resultsElement)
      setHasMore(
        resultsElement.scrollTop + resultsElement.clientHeight < resultsElement.scrollHeight - 2,
      );
  }
  onMount(() => {
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(resultsElement);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => releaseDialog(dialog));
  const { session } = useSession();
  const [sourceQuery, setSourceQuery] = createSignal(false);
  const [sourceResults] = createResource(sourceQuery, async (query) => ({
    ...(await api('/api/knowledge/browser-search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })),
    query,
  }));
  const imported = () =>
    !session()?.user ||
    !sourceQuery() ||
    sourceResults.loading ||
    sourceResults.error ||
    sourceResults()?.query !== query().trim()
      ? []
      : sourceResults()?.results?.filter((item) => item.sourceDocumentId) || [];
  const [query, setQuery] = createSignal('');
  const [localQuery, setLocalQuery] = createSignal(false);
  createEffect(() => {
    if (props.active) {
      setQuery('');
      setLocalQuery(false);
    }
  });
  const [recent] = createResource(
    () => props.active && !query().trim() && !!session()?.user,
    () => api('/api/helpdesk/recent-views'),
  );
  const [localResults] = createResource(localQuery, async (value) => ({
    ...(await api(
      `/api/helpdesk/global-search?list=1&sort=Name&pageSize=50&q=${encodeURIComponent(value)}`,
    )),
    query: value,
  }));
  const results = () =>
    query().trim()
      ? !localResults.error && !localResults.loading && localResults()?.query === query().trim()
        ? localResults()?.rows || []
        : []
      : !recent.error
        ? recent() || []
        : [];
  const localPending = () =>
    !!query().trim() &&
    !localResults.error &&
    (localQuery() !== query().trim() ||
      localResults.loading ||
      localResults()?.query !== query().trim());
  const sourcePending = () =>
    query().trim().length >= 2 &&
    !sourceResults.error &&
    (sourceQuery() !== query().trim() ||
      sourceResults.loading ||
      sourceResults()?.query !== query().trim());
  createEffect(() => {
    const value = props.active ? query().trim() : '';
    setLocalQuery(false);
    const timer = setTimeout(() => setLocalQuery(value || false), 250);
    onCleanup(() => clearTimeout(timer));
  });

  createEffect(() => {
    const term = query().trim();
    const enabled = props.active && session()?.user && term.length >= 2;
    setSourceQuery(false);
    const timer = setTimeout(() => setSourceQuery(enabled ? term : false), 300);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    results();
    if (!sourceResults.error) sourceResults();
    const frame = requestAnimationFrame(updateOverflow);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <dialog
      class="create-picker search-overlay"
      aria-labelledby="search-overlay-title"
      ref={(element) => {
        dialog = element;
        props.dialogRef(element);
      }}
      onClose={() => {
        releaseDialog(dialog);
        props.onClose?.(dialog);
      }}
      onClick={(event) => {
        if (event.target === dialog) dialog.close();
      }}
    >
      <div class="create-picker-heading">
        <h2 id="search-overlay-title">Search workspace</h2>
        <button aria-label="Close search" onClick={() => dialog.close()}>
          <Icon name="close" />
        </button>
      </div>
      <label class="overlay-search-input">
        <Icon name="search" />
        <input
          autofocus
          type="search"
          maxlength="200"
          aria-label="Search workspace content"
          placeholder="Search workspace…"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <p class="overlay-result-count" role="status">
        {query().trim() ? 'Search Results' : 'Recently Viewed'}
      </p>
      <div class="search-results-region">
        <div class="overlay-search-results" ref={resultsElement} onScroll={updateOverflow}>
          <Show when={localPending() || (!query().trim() && recent.loading)}>
            <Skeleton class="search-results-skeleton" label="Loading search results" lines={5} />
          </Show>
          <For each={results()}>
            {(item) => (
              <A href={item.href} onClick={() => dialog.close()}>
                <Icon name={item.icon} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.type}
                    <Show when={item.summary}> · {item.summary}</Show>
                  </small>
                </span>
                <Icon name="arrow" />
              </A>
            )}
          </For>
          <Show when={sourcePending() && !localPending()}>
            <Skeleton class="search-results-skeleton" label="Loading connected results" lines={2} />
          </Show>
          <Show when={localResults.error && query().trim()}>
            <p role="status">Search could not be loaded. Try again.</p>
          </Show>
          <Show when={sourceResults.error}>
            <p role="status">Connected-source access could not be verified.</p>
          </Show>
          <For each={imported()}>
            {(item) => (
              <A
                href={`/workspace/knowledge/source/${item.sourceDocumentId}`}
                onClick={() => dialog.close()}
              >
                <Icon name="plug" />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.permissionMode === 'source'
                      ? 'Source verified'
                      : 'AgentZuno-managed copy'}
                  </small>
                </span>
                <Icon name="arrow" />
              </A>
            )}
          </For>
          <Show
            when={
              !results().length &&
              !imported().length &&
              !localPending() &&
              !sourcePending() &&
              !recent.loading &&
              !localResults.error
            }
          >
            <p class="overlay-empty">
              {query().trim()
                ? localResults.loading
                  ? 'Searching…'
                  : 'No matching content. Try another word.'
                : recent.loading
                  ? 'Loading recently viewed items…'
                  : 'Search to find workspace content'}
            </p>
          </Show>
        </div>
        <Show when={hasMore()}>
          <div class="search-results-fade" aria-hidden="true" />
        </Show>
      </div>
    </dialog>
  );
}
