import TopicArticles from '../../../components/knowledge/TopicArticles.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import ListPagination from '../../../components/ListPagination.jsx';
import { useSession } from '../../../context/SessionContext.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import { For, Show, createEffect, onCleanup, createResource, createSignal } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import A from '../../../components/WorkspaceLink.jsx';
import PageHeading from '../../../components/PageHeading.jsx';
import KnowledgeList from '../../../components/knowledge/KnowledgeList.jsx';
import Icon from '../../../components/Icon.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
export default function KnowledgeBasePage() {
  const { preferences, savePreferences } = useSession();
  const pageSize = () => (preferences.error ? 20 : preferences()?.listPageSize || 20);
  const [isListEmpty, setIsListEmpty] = createSignal(false);
  const params = useParams();
  const { access } = useWorkspace();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const [base] = createResource(
    () => isAdmin() && params.id,
    (id) => api(`/api/helpdesk/knowledge-bases/${id}`),
  );
  const [tab, setTab] = createSignal('topics');
  const [query, setQuery] = createSignal('');
  const [topicQuery, setTopicQuery] = createSignal('');
  const [page, setPage] = createSignal(1);
  createEffect(() => {
    const value = query();
    const timer = setTimeout(() => {
      setTopicQuery(value);
      setPage(1);
    }, 200);
    onCleanup(() => clearTimeout(timer));
  });
  const [openTopics, setOpenTopics] = createSignal(new Set());
  const [topics] = createResource(
    () => isAdmin() && tab() === 'topics' && `${params.id}:${topicQuery()}:${page()}:${pageSize()}`,
    () =>
      api(
        `/api/helpdesk/lists/topics?list=1&sort=Name&direction=asc&base=${encodeURIComponent(params.id)}&q=${encodeURIComponent(topicQuery())}&page=${page()}&pageSize=${pageSize()}`,
      ),
  );
  function switchTab(value) {
    setTab(value);
    setQuery('');
    setTopicQuery('');
    setPage(1);
  }
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 'topics'
        : event.key === 'End'
          ? 'articles'
          : tab() === 'topics'
            ? 'articles'
            : 'topics';
    switchTab(next);
    document.getElementById(`base-tab-${next}`)?.focus();
  }
  return (
    <section class="reading-page knowledge-base-page">
      <Show when={base.error}>
        <ToastMessage tone="error">{base.error.message}</ToastMessage>
      </Show>
      <Show when={!base.error && base()}>
        {(item) => (
          <>
            <Breadcrumbs
              items={[
                { label: 'Knowledge Bases', href: '/workspace/knowledge?tab=bases' },
                { label: item().name },
              ]}
            />
            <div class="connections-heading">
              <div>
                <PageHeading title={item().name} />
                <span class="knowledge-base-context">Knowledge Base</span>
              </div>
              <div class="helpdesk-actions" data-list-actions>
                <A
                  class="workspace-button secondary small"
                  href={`/workspace/records/knowledge-base/${params.id}/edit`}
                >
                  Edit Knowledge Base
                </A>
                <A
                  class="workspace-button secondary small"
                  href={`/workspace/knowledge/topics/new?base=${encodeURIComponent(params.id)}`}
                >
                  Add Topic
                </A>
                <A
                  class="workspace-button small"
                  href={`/workspace/create/article?base=${encodeURIComponent(params.id)}`}
                >
                  Add Article
                </A>
              </div>
            </div>
            <Show when={item().description}>
              <p>{item().description}</p>
            </Show>
            <div class="list-toolbar">
              <label
                class="workspace-search"
                hidden={
                  tab() === 'topics'
                    ? !topics.loading && !!topics() && !topics()?.total && !query()
                    : isListEmpty()
                }
              >
                <Icon name="search" />
                <input
                  type="search"
                  maxlength="200"
                  aria-label={`Search ${tab()}`}
                  placeholder={`Search ${tab()}…`}
                  value={query()}
                  onInput={(event) => {
                    setQuery(event.currentTarget.value);
                  }}
                />
              </label>
              <div
                class="inbox-status-filters"
                role="tablist"
                aria-label="Knowledge base sections"
                onKeyDown={tabKey}
              >
                <For each={['topics', 'articles']}>
                  {(value) => (
                    <button
                      id={`base-tab-${value}`}
                      class="inbox-filter-button"
                      role="tab"
                      aria-selected={tab() === value}
                      aria-controls="knowledge-base-panel"
                      tabindex={tab() === value ? 0 : -1}
                      onClick={() => switchTab(value)}
                    >
                      {value === 'topics' ? 'Topics' : 'Articles'}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <section
              id="knowledge-base-panel"
              role="tabpanel"
              aria-labelledby={`base-tab-${tab()}`}
            >
              <Show when={tab() === 'articles'}>
                <KnowledgeList
                  onEmptyChange={setIsListEmpty}
                  label="Articles"
                  source="/api/helpdesk/lists/articles"
                  query={query()}
                  sourceParams={{ base: params.id }}
                  emptyText="No articles in this knowledge base yet."
                />
              </Show>
              <Show when={tab() === 'topics'}>
                <Show when={topics.error}>
                  <ToastMessage tone="error">{topics.error.message}</ToastMessage>
                </Show>
                <Show when={topics.loading && !topics.latest}>
                  <Skeleton label="Loading topics" lines={4} />
                </Show>
                <For each={!topics.error ? topics()?.rows || [] : []}>
                  {(topic) => (
                    <details
                      class="knowledge-topic-accordion"
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setOpenTopics((previous) => {
                          const next = new Set(previous);
                          if (open) next.add(topic.id);
                          else next.delete(topic.id);
                          return next;
                        });
                      }}
                    >
                      <summary>
                        <span>{topic.title}</span>
                        <span>{topic.articleCount} Articles</span>
                      </summary>
                      <Show when={openTopics().has(topic.id)}>
                        <div class="knowledge-topic-content">
                          <div class="helpdesk-actions" data-list-actions>
                            <A
                              class="workspace-button secondary small"
                              href={`/workspace/knowledge/topics/${topic.id}`}
                            >
                              Edit Topic
                            </A>
                            <A
                              class="workspace-button secondary small"
                              href={`/workspace/create/article?base=${encodeURIComponent(params.id)}&topic=${encodeURIComponent(topic.id)}`}
                            >
                              Add Article
                            </A>
                          </div>
                          <TopicArticles baseId={params.id} topicId={topic.id} />
                        </div>
                      </Show>
                    </details>
                  )}
                </For>
                <Show when={!topics.loading && !topics.error && topics()?.total === 0}>
                  <div class="record-empty-state">
                    <h3>No Topics Yet</h3>
                    <p>Add a topic to organize this knowledge base.</p>
                    <A
                      class="workspace-button small"
                      href={`/workspace/knowledge/topics/new?base=${encodeURIComponent(params.id)}`}
                    >
                      Add Topic
                    </A>
                  </div>
                </Show>
                <Show when={!topics.error && topics()?.total > 0}>
                  <ListPagination
                    total={topics().total}
                    page={topics().page}
                    pageSize={topics().pageSize}
                    loading={topics.loading}
                    onPage={setPage}
                    onPageSize={async (value) => {
                      await savePreferences({ listPageSize: value });
                      setPage(1);
                    }}
                  />
                </Show>
              </Show>
            </section>
          </>
        )}
      </Show>
    </section>
  );
}
