import { For, Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useSession } from '../../../context/SessionContext.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import A from '../../../components/WorkspaceLink.jsx';
import ActionMenu from '../../../components/ActionMenu.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import ListPagination from '../../../components/ListPagination.jsx';
import KnowledgeExplorer from '../../../components/knowledge/KnowledgeExplorer.jsx';
import KnowledgeResizeHandle from '../../../components/knowledge/KnowledgeResizeHandle.jsx';
import KnowledgeQuickEditor from '../../../components/knowledge/KnowledgeQuickEditor.jsx';
import ArticleReadPage from './ArticleReadPage.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import Icon from '../../../components/Icon.jsx';

export default function KnowledgeCenterPage() {
  const { preferences, savePreferences, session } = useSession();
  const { access, refresh } = useWorkspace();
  const canManage = () => !access.error && access()?.role === 'admin';
  const [query, setQuery] = useSearchParams();
  const [revision, setRevision] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [search, setSearch] = createSignal('');
  const [applied, setApplied] = createSignal('');
  const [editor, setEditor] = createSignal(null);
  const [mobileView, setMobileView] = createSignal(
    query.article || query.base ? 'content' : 'folders',
  );
  const pageSize = () => (preferences.error ? 20 : preferences()?.listPageSize || 20);
  createEffect(() => {
    const text = search();
    const timer = setTimeout(() => setApplied(text), 200);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    query.base;
    query.topic;
    applied();
    setPage(1);
  });
  const [directory] = createResource(
    () => `${query.base || ''}:${query.topic || ''}:${page()}:${pageSize()}:${revision()}`,
    () =>
      api(
        `/api/helpdesk/knowledge-directory?${new URLSearchParams({ base: query.base || '', topic: query.topic || '', page: String(page()), pageSize: String(pageSize()) })}`,
      ),
  );
  const [results] = createResource(
    () => applied() && `${applied()}:${page()}:${pageSize()}:${revision()}`,
    () =>
      api(
        `/api/helpdesk/knowledge-center?${new URLSearchParams({ q: applied(), page: String(page()), pageSize: String(pageSize()) })}`,
      ),
  );
  const data = () => (directory.error ? null : directory());
  const folder = () => data()?.folder;
  const rows = () =>
    applied()
      ? results.error
        ? []
        : (results()?.articles?.rows || []).map((article) => ({
            ...article,
            name: article.title,
            type: 'article',
          }))
      : data()?.rows || [];
  const selected = () => query.article || query.topic || query.base || '';
  const ancestors = () => [query.base, ...(folder()?.ancestors || [])].filter(Boolean);
  const articleLink = (node) => {
    const base = node?.baseId || query.base;
    const topic = node ? (node.type === 'topic' ? node.id : '') : query.topic;
    return `/workspace/create/article${base ? `?${new URLSearchParams({ base, ...(topic ? { topic } : {}) })}` : ''}`;
  };
  function select(node) {
    setSearch('');
    setApplied('');
    setQuery({
      base: node.baseId || (node.type === 'base' ? node.id : undefined),
      topic: node.type === 'topic' ? node.id : node.topicId || undefined,
      article: node.type === 'article' ? node.id : undefined,
      view: undefined,
    });
    setMobileView('content');
  }
  function editFolder() {
    if (!folder()) return;
    setEditor({
      kind: folder().type,
      record: { ...folder(), knowledgeBaseId: query.base },
      baseId: query.base,
    });
  }
  function addTopic(node) {
    setEditor({
      kind: 'topic',
      baseId: node?.baseId || query.base,
      parentTopicId: node ? (node.type === 'topic' ? node.id : '') : query.topic || '',
    });
  }
  const actions = () => [
    { label: 'Add Knowledge Base', onClick: () => setEditor({ kind: 'base' }) },
    ...(query.base && (folder()?.depth || 0) < 3
      ? [{ label: 'Add Topic', onClick: () => addTopic() }]
      : []),
    ...(folder()?.editable
      ? [
          {
            label: `Edit ${folder().type === 'base' ? 'Knowledge Base' : 'Topic'}`,
            onClick: editFolder,
          },
        ]
      : []),
  ];
  async function saved(record) {
    const current = editor();
    await refresh();
    setRevision((value) => value + 1);
    if (!current.record)
      select({
        id: record.id,
        type: current.kind,
        baseId: current.kind === 'base' ? record.id : current.baseId,
      });
  }
  const loading = () =>
    applied() ? results.loading && !results.latest : directory.loading && !directory.latest;
  const total = () => (applied() ? results()?.articles?.total || 0 : data()?.total || 0);
  return (
    <section class="knowledge-workspace">
      <header class="knowledge-workspace-heading">
        <h1>Knowledge</h1>
        <label class="workspace-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search knowledge"
            placeholder="Search knowledge…"
            maxlength="200"
            value={search()}
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              setMobileView('content');
            }}
          />
        </label>
        <div class="helpdesk-actions">
          <button
            class="workspace-button secondary small knowledge-browse-toggle"
            aria-label="Browse knowledge folders"
            aria-pressed={mobileView() === 'folders'}
            onClick={() => setMobileView(mobileView() === 'folders' ? 'content' : 'folders')}
          >
            <Icon name="folder" />
          </button>
          <Show when={canManage()}>
            <A class="workspace-button small" href={articleLink()}>
              Add Article
            </A>
            <ActionMenu label="Knowledge actions" items={actions()} />
          </Show>
        </div>
      </header>
      <div class="knowledge-workspace-body" data-mobile-view={mobileView()}>
        <nav class="knowledge-explorer-sidebar" aria-label="Knowledge explorer">
          <div class="knowledge-explorer-heading">
            <span>Knowledge Bases</span>
            <Show when={canManage()}>
              <button
                type="button"
                class="workspace-button secondary small icon-only"
                aria-label="Add Knowledge Base"
                title="Add Knowledge Base"
                onClick={() => setEditor({ kind: 'base' })}
              >
                <Icon name="plus" />
              </button>
            </Show>
          </div>
          <KnowledgeExplorer
            selected={selected()}
            ancestors={ancestors()}
            revision={revision()}
            onSelect={select}
            canManage={canManage()}
            onAddTopic={addTopic}
            articleLink={articleLink}
          />
        </nav>
        <KnowledgeResizeHandle
          storageKey={`agentzuno-knowledge-width-${session()?.user?.id}-${session()?.user?.workspaceId}`}
        />
        <div class="knowledge-explorer-reader">
          <Show when={query.base || query.topic || query.article || applied()}>
            <Breadcrumbs
              label="Knowledge location"
              items={[
                { label: 'Knowledge', href: '/workspace/knowledge' },
                ...(folder()?.path || []).map((item) => ({
                  label: item.name,
                  href: `/workspace/knowledge?base=${encodeURIComponent(item.baseId)}${item.type === 'topic' ? `&topic=${encodeURIComponent(item.id)}` : ''}`,
                })),
                applied() && { label: 'Search Results' },
              ]}
            />
          </Show>
          <Show
            when={query.article && !applied()}
            fallback={
              <>
                <Show when={folder() && !applied()}>
                  <h2 class="knowledge-folder-title">{folder().name}</h2>
                  <Show when={folder().description}>
                    <p class="field-help">{folder().description}</p>
                  </Show>
                </Show>
                <Show when={directory.error || results.error}>
                  <ToastMessage tone="error">
                    {directory.error?.message || results.error?.message}
                  </ToastMessage>
                </Show>
                <Show
                  when={loading()}
                  fallback={
                    <>
                      <div class="help-center-grid">
                        <For each={rows().filter((row) => row.type !== 'article')}>
                          {(node) => (
                            <article class="help-center-base-card">
                              <div class="help-center-card-heading">
                                <A
                                  class="help-center-base-title"
                                  href={`/workspace/knowledge?base=${encodeURIComponent(node.baseId)}${node.type === 'topic' ? `&topic=${encodeURIComponent(node.id)}` : ''}`}
                                  onClick={(event) => {
                                    if (
                                      event.ctrlKey ||
                                      event.metaKey ||
                                      event.shiftKey ||
                                      event.altKey
                                    )
                                      return;
                                    event.preventDefault();
                                    select(node);
                                  }}
                                >
                                  {node.name}
                                </A>
                              </div>
                              <Show when={node.description}>
                                <p>{node.description}</p>
                              </Show>
                              <span class="help-center-card-chevron" aria-hidden="true">
                                <Icon name="chevron-right" />
                              </span>
                            </article>
                          )}
                        </For>
                        <Show when={canManage() && !query.base && !applied()}>
                          <button
                            class="help-center-add-card"
                            onClick={() => setEditor({ kind: 'base' })}
                          >
                            <Icon name="add" />
                            <span>Add Knowledge Base</span>
                          </button>
                        </Show>
                      </div>
                      <div class="help-center-article-list">
                        <For each={rows().filter((row) => row.type === 'article')}>
                          {(article) => (
                            <article class="help-center-article-row">
                              <Icon name="file" />
                              <A
                                href={`/workspace/knowledge?article=${encodeURIComponent(article.id)}${article.baseId ? `&base=${encodeURIComponent(article.baseId)}` : ''}${article.topicId ? `&topic=${encodeURIComponent(article.topicId)}` : ''}`}
                                onClick={(event) => {
                                  if (
                                    event.ctrlKey ||
                                    event.metaKey ||
                                    event.shiftKey ||
                                    event.altKey
                                  )
                                    return;
                                  event.preventDefault();
                                  select(article);
                                }}
                              >
                                <strong>{article.name}</strong>
                                <Show when={article.summary}>
                                  <p>{article.summary}</p>
                                </Show>
                              </A>
                              <Show when={article.status}>
                                <span class="activity-status">{article.status}</span>
                              </Show>
                            </article>
                          )}
                        </For>
                      </div>
                      <Show when={!rows().length && (query.base || !canManage() || applied())}>
                        <p class="knowledge-empty-folder">
                          {applied() ? 'No matching articles.' : 'This folder is empty.'}
                        </p>
                      </Show>
                      <Show when={total() > pageSize()}>
                        <ListPagination
                          total={total()}
                          page={page()}
                          pageSize={pageSize()}
                          loading={directory.loading || results.loading}
                          onPage={setPage}
                          onPageSize={async (size) => {
                            await savePreferences({ listPageSize: size });
                            setPage(1);
                          }}
                        />
                      </Show>
                    </>
                  }
                >
                  <div
                    class="help-center-grid"
                    role="status"
                    aria-label="Loading knowledge bases"
                    aria-busy="true"
                  >
                    <For each={[0, 1, 2, 3, 4, 5]}>
                      {() => (
                        <div
                          class="help-center-base-card help-center-base-skeleton"
                          aria-hidden="true"
                        >
                          <span class="skeleton-line" />
                          <span class="skeleton-line" />
                          <span class="skeleton-line" />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </>
            }
          >
            <ArticleReadPage embedded articleId={query.article} />
          </Show>
        </div>
      </div>
      <Show when={editor()} keyed>
        {(current) => (
          <KnowledgeQuickEditor
            kind={current.kind}
            record={current.record}
            baseId={current.baseId}
            parentTopicId={current.parentTopicId}
            onClose={() => setEditor(null)}
            onSaved={saved}
          />
        )}
      </Show>
    </section>
  );
}
