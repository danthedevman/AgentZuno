import KnowledgeCenterPage from './KnowledgeCenterPage.jsx';
import { For, Match, Show, Switch, createSignal } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import A from '../../components/WorkspaceLink.jsx';
import KnowledgeList from '../../components/KnowledgeList.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import Icon from '../../components/Icon.jsx';

const tabs = [
  { id: 'bases', label: 'Bases' },
  { id: 'articles', label: 'Articles' },
  { id: 'topics', label: 'Topics' },
];

export default function KnowledgePage() {
  const [isListEmpty, setIsListEmpty] = createSignal(false);
  const { access } = useWorkspace();
  const canManage = () => !access?.error && access?.()?.role === 'admin';
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = createSignal('');
  const tab = () =>
    tabs.some((item) => item.id === params.tab)
      ? params.tab
      : params.base || params.topic
        ? 'articles'
        : 'bases';
  function switchTab(id) {
    setQuery('');
    setParams({ tab: id, base: undefined, topic: undefined });
  }
  function handleTabKey(event, index) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      switchTab(tabs[next].id);
      event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next]?.focus();
    }
  }
  return (
    <>
      <Show when={canManage()}>
        <PageHeading title="Knowledge" />
      </Show>
      <Show when={canManage()} fallback={<KnowledgeCenterPage />}>
        <nav class="knowledge-tabs" role="tablist" aria-label="Knowledge sections">
          <For each={tabs}>
            {(item, index) => (
              <button
                id={`knowledge-tab-${item.id}`}
                role="tab"
                aria-selected={tab() === item.id}
                aria-controls={`knowledge-panel-${item.id}`}
                tabindex={tab() === item.id ? 0 : -1}
                onClick={() => switchTab(item.id)}
                onKeyDown={(event) => handleTabKey(event, index())}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
        <section
          role="tabpanel"
          id={`knowledge-panel-${tab()}`}
          aria-labelledby={`knowledge-tab-${tab()}`}
        >
          <div class="list-toolbar" data-list-actions>
            <label class="workspace-search" hidden={isListEmpty()}>
              <Icon name="search" />
              <input
                type="search"
                maxlength="200"
                aria-label={`Search ${tab()}`}
                placeholder={`Search ${tab()}…`}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <A
              class="workspace-button small"
              href={
                tab() === 'bases'
                  ? '/workspace/create/knowledge-base'
                  : tab() === 'topics'
                    ? '/workspace/knowledge/topics/new'
                    : '/workspace/create/article'
              }
            >
              {tab() === 'bases'
                ? 'Create Knowledge Base'
                : tab() === 'topics'
                  ? 'Create Topic'
                  : 'Create Article'}
            </A>
          </div>
          <Show when={tab() === 'articles' && (params.base || params.topic)}>
            <button
              class="card-link"
              onClick={() => setParams({ base: undefined, topic: undefined })}
            >
              Clear Base and Topic Filters
            </button>
          </Show>
          <Switch>
            <Match when={tab() === 'bases'}>
              <KnowledgeList
                onEmptyChange={setIsListEmpty}
                label="Knowledge Bases"
                source="/api/helpdesk/lists/bases"
                query={query()}
                emptyText="No knowledge bases yet."
              />
            </Match>
            <Match when={tab() === 'articles'}>
              <KnowledgeList
                onEmptyChange={setIsListEmpty}
                label="Articles"
                source="/api/helpdesk/lists/articles"
                query={query()}
                sourceParams={{ base: params.base, topic: params.topic }}
                emptyText="No articles found. Create an article or adjust your filters."
              />
            </Match>
            <Match when={tab() === 'topics'}>
              <KnowledgeList
                onEmptyChange={setIsListEmpty}
                label="Topics"
                source="/api/helpdesk/lists/topics"
                query={query()}
                emptyText="No topics yet."
              />
            </Match>
          </Switch>
        </section>
      </Show>
    </>
  );
}
