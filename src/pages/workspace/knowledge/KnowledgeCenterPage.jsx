import ProfileAvatar from '../../../components/identity/ProfileAvatar.jsx';
import { For, Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { useSession } from '../../../context/SessionContext.jsx';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { api } from '../../../services/api.js';
import A from '../../../components/WorkspaceLink.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import ListPagination from '../../../components/ListPagination.jsx';
import KnowledgeExplorer from '../../../components/knowledge/KnowledgeExplorer.jsx';
import KnowledgeResizeHandle from '../../../components/knowledge/KnowledgeResizeHandle.jsx';
import KnowledgeQuickEditor from '../../../components/knowledge/KnowledgeQuickEditor.jsx';
import ArticleReadPage from './ArticleReadPage.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import Icon from '../../../components/Icon.jsx';
import TooltipRegion from '../../../components/TooltipRegion.jsx';

export default function KnowledgeCenterPage() {
  const { preferences, savePreferences, session } = useSession();
  const { access, refresh } = useWorkspace();
  const canManage = () => !access.error && access()?.role === 'admin';
  const [query, setQuery] = useSearchParams();
  const [revision, setRevision] = createSignal(0);
  const [collapseRevision, setCollapseRevision] = createSignal(0);
  const [folderSearch, setFolderSearch] = createSignal('');
  const [appliedFolderSearch, setAppliedFolderSearch] = createSignal('');
  createEffect(() => {
    const value = folderSearch();
    const timer = setTimeout(() => setAppliedFolderSearch(value), 200);
    onCleanup(() => clearTimeout(timer));
  });
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
  function editFolder(node) {
    setEditor({
      kind: node.type,
      record: { ...node, knowledgeBaseId: node.baseId },
      baseId: node.baseId,
    });
  }
  function addTopic(node) {
    setEditor({
      kind: 'topic',
      baseId: node?.baseId || query.base,
      parentTopicId: node ? (node.type === 'topic' ? node.id : '') : query.topic || '',
    });
  }
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
          </Show>
        </div>
      </header>
      <div class="knowledge-workspace-body" data-mobile-view={mobileView()}>
        <nav class="knowledge-explorer-sidebar" aria-label="Knowledge explorer">
          <TooltipRegion>
            <div class="knowledge-explorer-heading">
              <label class="workspace-search knowledge-folder-search">
                <Icon name="search" />
                <input
                  type="search"
                  aria-label="Search knowledge folders"
                  placeholder="Search folders…"
                  maxlength="200"
                  value={folderSearch()}
                  onInput={(event) => setFolderSearch(event.currentTarget.value)}
                />
              </label>
              <div
                class="knowledge-tree-actions"
                role="group"
                aria-label="Knowledge folder actions"
              >
                <Show when={canManage()}>
                  <button
                    type="button"
                    class="workspace-button secondary small icon-only"
                    aria-label="Add Knowledge Base"
                    data-tooltip="Add Knowledge Base"
                    onClick={() => setEditor({ kind: 'base' })}
                  >
                    <Icon name="folder-add" />
                  </button>
                </Show>
                <button
                  type="button"
                  class="workspace-button secondary small icon-only"
                  aria-label="Refresh knowledge folders"
                  data-tooltip="Refresh knowledge folders"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  <Icon name="refresh" />
                </button>
                <button
                  type="button"
                  class="workspace-button secondary small icon-only"
                  aria-label="Collapse all knowledge folders"
                  data-tooltip="Collapse all knowledge folders"
                  onClick={() => setCollapseRevision((value) => value + 1)}
                >
                  <Icon name="collapse" />
                </button>
              </div>
            </div>
            <KnowledgeExplorer
              search={appliedFolderSearch()}
              selected={selected()}
              ancestors={ancestors()}
              revision={revision()}
              collapseRevision={collapseRevision()}
              onSelect={select}
              canManage={canManage()}
              onAddTopic={addTopic}
              onEditFolder={editFolder}
              articleLink={articleLink}
            />
          </TooltipRegion>
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
                                <span class="knowledge-article-metadata">
                                  <span class="knowledge-article-author">
                                    <ProfileAvatar name={article.author?.name} />
                                    <span>
                                      {article.author?.label || 'Author'}:{' '}
                                      {article.author?.name || 'Unavailable'}
                                    </span>
                                  </span>
                                  <Show
                                    when={
                                      article.updatedAt &&
                                      Number.isFinite(new Date(article.updatedAt).getTime())
                                    }
                                  >
                                    <time datetime={article.updatedAt}>
                                      Updated{' '}
                                      {new Date(article.updatedAt).toLocaleDateString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric',
                                      })}
                                    </time>
                                  </Show>
                                </span>
                                <Show when={article.summary}>
                                  <p>{article.summary}</p>
                                </Show>
                              </A>
                              <Show when={article.status}>
                                <span
                                  class="activity-status"
                                  data-tone={
                                    article.status === 'Published' ? 'positive' : 'informational'
                                  }
                                >
                                  <span class="activity-status-dot" />
                                  {article.status}
                                </span>
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
