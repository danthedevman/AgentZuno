import { createStore, reconcile } from 'solid-js/store';
import CatalogItemImage from '../../components/CatalogItemImage.jsx';
import { createSignal, createResource, createEffect, onCleanup, For, Show } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { api } from '../../services/api.js';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import Icon from '../../components/Icon.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import A from '../../components/WorkspaceLink.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
export default function CatalogPage() {
  const navigate = useNavigate();
  const [routeQuery] = useSearchParams();
  const path = useWorkspacePath();
  const { access } = useWorkspace();
  const [error, setError] = createSignal('');
  const [opening, setOpening] = createSignal('');
  const [query, setQuery] = createSignal(routeQuery.q || '');
  const [search, setSearch] = createSignal('');
  const [page, setPage] = createSignal(1);
  const [loadedItems, setLoadedItems] = createSignal([]);
  const [catalogMeta, setCatalogMeta] = createSignal(null);
  const [loadSentinel, setLoadSentinel] = createSignal();
  const [expanded, setExpanded] = createSignal(new Set());
  const [groups, setGroups] = createStore([]);
  const topicGroups = () => groups;
  createEffect(() => {
    const nextGroups = [
      ...new Map(
        loadedItems().map((item) => [
          item.categoryId || 'general',
          { id: item.categoryId || 'general', name: item.category || 'General' },
        ]),
      ).values(),
    ].map((group) => ({
      ...group,
      items: loadedItems().filter((item) => (item.categoryId || 'general') === group.id),
    }));
    setGroups(reconcile(nextGroups, { key: 'id' }));
  });
  createEffect(() => {
    const value = query().trim();
    const timer = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 250);
    onCleanup(() => clearTimeout(timer));
  });
  const [items, { refetch }] = createResource(
    () => ({ page: page(), query: search() }),
    async (source) => ({
      ...(await api(
        `/api/helpdesk/catalog?list=1&sort=Workflow&page=${source.page}&pageSize=20&q=${encodeURIComponent(source.query)}`,
      )),
      query: source.query,
    }),
  );
  createEffect(() => {
    if (items.error) return;
    const result = items();
    if (!result || result.query !== search()) return;
    setCatalogMeta(result);
    setLoadedItems((previous) =>
      result.page === 1
        ? result.rows
        : [...new Map([...previous, ...result.rows].map((item) => [item.id, item])).values()],
    );
  });
  const hasMore = () =>
    catalogMeta()?.query === search() && loadedItems().length < (catalogMeta()?.total || 0);
  function loadMore() {
    if (items.loading) return;
    if (items.error) {
      refetch().catch((error) => setError(error.message));
      return;
    }
    if (hasMore()) setPage((value) => value + 1);
  }
  createEffect(() => {
    const more = hasMore();
    if (items.loading || !more || !loadSentinel() || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '240px' },
    );
    observer.observe(loadSentinel());
    onCleanup(() => observer.disconnect());
  });
  async function open(item) {
    if (opening()) return;
    setOpening(item.id);
    try {
      const chat = await api('/api/helpdesk/support/conversations', {
        method: 'POST',
        body: JSON.stringify({ requestId: crypto.randomUUID(), workflowId: item.id }),
      });
      navigate(path(`/workspace/chat/${chat.id}`));
    } catch (error) {
      setError(error.message);
    } finally {
      setOpening('');
    }
  }
  return (
    <section class="reading-page catalog-page">
      <div class="connections-heading">
        <PageHeading title="Catalog" />
        <Show when={access()?.role === 'admin'}>
          <div class="helpdesk-actions">
            <A class="workspace-button secondary small" href="/workspace/data/ref-catalog-category">
              Categories
            </A>
            <A
              class="workspace-button small"
              href="/workspace/data/ref-catalog-category/records/new"
            >
              Add Category
            </A>
          </div>
        </Show>
      </div>
      <Show when={error() || items.error}>
        <ToastMessage tone="error">{error() || items.error?.message}</ToastMessage>
      </Show>
      <Show
        when={items.loading || catalogMeta()?.total || search()}
        fallback={
          <div class="record-empty-state">
            <h3>No catalog items available</h3>
            <Show when={access()?.role === 'admin'}>
              <A class="workspace-button" href="/workspace/workflows/new">
                New Workflow
              </A>
            </Show>
          </div>
        }
      >
        <div class="catalog-launcher-layout">
          <div class="catalog-launcher-content">
            <div class="catalog-toolbar">
              <label class="workspace-search">
                <Icon name="search" />
                <input
                  type="search"
                  aria-label="Search catalog"
                  maxlength="200"
                  placeholder="Search catalog…"
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
            </div>
            <For each={topicGroups()}>
              {(group) => (
                <section class="catalog-topic-group">
                  <button
                    type="button"
                    class="catalog-topic-toggle"
                    aria-expanded={!expanded().has(group.id)}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        next.has(group.id) ? next.delete(group.id) : next.add(group.id);
                        return next;
                      })
                    }
                  >
                    <strong>{group.name}</strong>
                    <Icon name={expanded().has(group.id) ? 'chevron-right' : 'chevron-down'} />
                  </button>
                  <Show when={!expanded().has(group.id)}>
                    <div class="catalog-card-grid">
                      <For each={group.items}>
                        {(item) => (
                          <button
                            class="catalog-item-card"
                            aria-label={`Open ${item.name}`}
                            title={item.description || item.name}
                            classList={{ 'is-opening': opening() === item.id }}
                            aria-busy={opening() === item.id}
                            type="button"
                            onClick={() => open(item)}
                            disabled={!!opening()}
                          >
                            <CatalogItemImage
                              imageId={item.catalogImageId}
                              workflowId={item.id}
                              icon={item.catalogIcon}
                            />
                            <strong>{item.name}</strong>
                            <Show when={opening() === item.id}>
                              <span class="catalog-card-action" role="status">
                                Opening…
                              </span>
                            </Show>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              )}
            </For>
            <Show when={items.loading && !loadedItems().length}>
              <div class="catalog-card-grid">
                <For each={[1, 2, 3, 4, 5, 6]}>
                  {() => (
                    <div class="catalog-item-card catalog-tile-skeleton">
                      <span class="skeleton-block" aria-hidden="true" />
                      <Skeleton lines={1} label="Loading catalog item" />
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={!items.loading && !items.error && !catalogMeta()?.total}>
              <div class="record-empty-state">
                <h3>No matching catalog items</h3>
              </div>
            </Show>
            <Show when={hasMore()}>
              <div ref={setLoadSentinel} class="catalog-load-more">
                <button
                  class="workspace-button secondary small"
                  type="button"
                  disabled={items.loading}
                  onClick={loadMore}
                >
                  {items.loading ? 'Loading…' : items.error ? 'Retry Loading' : 'Load More'}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
