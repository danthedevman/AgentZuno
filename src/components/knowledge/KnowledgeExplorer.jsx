import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { api } from '../../services/api.js';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';

function Directory(props) {
  const [page, setPage] = createSignal(1);
  const [nodes, setNodes] = createStore([]);
  createEffect(() => {
    props.revision;
    props.search;
    setPage(1);
  });
  createEffect(() => {
    props.search;
    setNodes([]);
  });
  const [result, { refetch }] = createResource(
    () =>
      `${props.baseId || ''}:${props.topicId || ''}:${page()}:${props.revision}:${props.search || ''}`,
    () =>
      api(
        `/api/helpdesk/knowledge-directory?${new URLSearchParams({ base: props.baseId || '', topic: props.topicId || '', q: props.search || '', page: String(page()), pageSize: '50' })}`,
      ),
  );
  createEffect(() => {
    if (result.error || !result()) return;
    const rows = result().rows;
    setNodes(
      reconcile(
        page() === 1
          ? rows
          : [...nodes.filter((node) => !rows.some((row) => row.id === node.id)), ...rows],
        { key: 'id' },
      ),
    );
  });
  return (
    <>
      <Show when={result.loading && !nodes.length}>
        <Skeleton label="Loading folders" lines={3} />
      </Show>
      <Show when={result.error}>
        <ToastMessage tone="error">{result.error?.message}</ToastMessage>
        <button class="workspace-button secondary small" onClick={refetch}>
          Retry
        </button>
      </Show>
      <For each={nodes}>
        {(node) => (
          <TreeNode
            node={node}
            search={props.search}
            selected={props.selected}
            ancestors={props.ancestors}
            revision={props.revision}
            collapseRevision={props.collapseRevision}
            level={props.level || 1}
            onSelect={props.onSelect}
            canManage={props.canManage}
            onAddTopic={props.onAddTopic}
            onEditFolder={props.onEditFolder}
            articleLink={props.articleLink}
          />
        )}
      </For>
      <Show
        when={!result.loading && !result.error && !nodes.length && (props.baseId || props.search)}
      >
        <li role="none" class="knowledge-tree-empty">
          <span class="knowledge-empty-message">
            {props.search
              ? 'No matching folders or articles.'
              : props.topicId
                ? 'No articles'
                : 'No topics'}
          </span>
          <Show when={props.canManage && !props.search}>
            <Show
              when={props.topicId}
              fallback={
                <button
                  type="button"
                  class="workspace-button secondary small knowledge-empty-add"
                  onClick={() =>
                    props.onAddTopic({ type: 'base', id: props.baseId, baseId: props.baseId })
                  }
                >
                  <Icon name="add" />
                  Add Topic
                </button>
              }
            >
              <A
                class="workspace-button secondary small knowledge-empty-add"
                href={props.articleLink({ type: 'topic', id: props.topicId, baseId: props.baseId })}
              >
                <Icon name="add" />
                Add Article
              </A>
            </Show>
          </Show>
        </li>
      </Show>
      <Show when={result()?.hasNext}>
        <li role="none">
          <button
            class="knowledge-tree-more"
            disabled={result.loading}
            onClick={() => setPage(page() + 1)}
          >
            Load more
          </button>
        </li>
      </Show>
    </>
  );
}

function TreeNode(props) {
  const [expanded, setExpanded] = createSignal(false);
  const folder = () => props.node.type !== 'article';
  createEffect(() => {
    props.collapseRevision;
    setExpanded(false);
  });
  createEffect(() => {
    if (folder() && props.ancestors?.includes(props.node.id)) setExpanded(true);
  });
  const selected = () => props.selected === props.node.id;
  const href = () =>
    `/workspace/knowledge?${new URLSearchParams({ base: props.node.baseId, ...(props.node.type === 'topic' ? { topic: props.node.id } : props.node.topicId ? { topic: props.node.topicId } : {}), ...(folder() ? {} : { article: props.node.id }) })}`;
  return (
    <li
      role="treeitem"
      aria-level={props.level}
      aria-label={props.node.name}
      aria-selected={selected()}
      aria-expanded={folder() ? expanded() : undefined}
      tabindex={selected() || props.level === 1 ? 0 : -1}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const tree = event.currentTarget.closest('[role=tree]');
        const items = [...tree.querySelectorAll('[role=treeitem]')];
        const index = items.indexOf(event.currentTarget);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          items[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : Math.max(
                    0,
                    Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                  )
          ]?.focus();
        } else if (event.key === 'ArrowRight' && folder()) {
          event.preventDefault();
          if (!expanded()) setExpanded(true);
          else items[index + 1]?.focus();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (expanded()) setExpanded(false);
          else event.currentTarget.parentElement.closest('[role=treeitem]')?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (folder()) setExpanded(true);
          props.onSelect(props.node);
        }
      }}
    >
      <div
        class="knowledge-tree-row"
        classList={{ 'is-selected': selected(), 'is-article': !folder() }}
      >
        <Show when={folder()} fallback={<span class="knowledge-tree-expander-spacer" />}>
          <button
            class="knowledge-tree-expander"
            tabindex="-1"
            aria-label={`${expanded() ? 'Collapse' : 'Expand'} ${props.node.name}`}
            onClick={() => setExpanded(!expanded())}
          >
            <Icon name={expanded() ? 'chevron-down' : 'chevron-right'} />
          </button>
        </Show>
        <Icon
          name={
            props.node.type === 'article'
              ? 'file'
              : props.node.type === 'base'
                ? 'book'
                : expanded()
                  ? 'folder-open'
                  : 'folder'
          }
        />
        <A
          href={href()}
          tabindex="-1"
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (folder()) setExpanded(true);
            props.onSelect(props.node);
          }}
        >
          {props.node.name}
        </A>
        <Show when={props.canManage && folder()}>
          <div
            class="knowledge-tree-actions"
            role="group"
            aria-label={`Create in ${props.node.name}`}
          >
            <Show when={props.node.editable}>
              <button
                type="button"
                class="workspace-button secondary small icon-only"
                aria-label={`Edit ${props.node.name}`}
                data-tooltip={props.node.type === 'base' ? 'Edit Knowledge Base' : 'Edit Topic'}
                onClick={() => props.onEditFolder(props.node)}
              >
                <Icon name="edit" />
              </button>
            </Show>
            <A
              class="workspace-button secondary small icon-only"
              href={props.articleLink(props.node)}
              aria-label={`Add article in ${props.node.name}`}
              data-tooltip="Add Article"
            >
              <Icon name="file-add" />
            </A>
            <Show when={props.node.depth < 3}>
              <button
                type="button"
                class="workspace-button secondary small icon-only"
                aria-label={`Add topic in ${props.node.name}`}
                data-tooltip="Add Topic"
                onClick={() => {
                  setExpanded(true);
                  props.onAddTopic(props.node);
                }}
              >
                <Icon name="folder-add" />
              </button>
            </Show>
          </div>
        </Show>
        <Show when={props.canManage && !folder()}>
          <div class="knowledge-tree-actions knowledge-article-overlay">
            <A
              class="workspace-button secondary small icon-only"
              href={`/workspace/articles/${props.node.id}/edit`}
              aria-label={`Edit ${props.node.name}`}
              data-tooltip="Edit Article"
            >
              <Icon name="edit" />
            </A>
          </div>
        </Show>
      </div>
      <Show when={folder() && expanded() && !props.search}>
        <ul role="group">
          <Directory
            baseId={props.node.baseId}
            topicId={props.node.type === 'topic' ? props.node.id : ''}
            revision={props.revision}
            collapseRevision={props.collapseRevision}
            ancestors={props.ancestors}
            search={props.search}
            selected={props.selected}
            level={props.level + 1}
            onSelect={props.onSelect}
            canManage={props.canManage}
            onAddTopic={props.onAddTopic}
            onEditFolder={props.onEditFolder}
            articleLink={props.articleLink}
          />
        </ul>
      </Show>
    </li>
  );
}

export default function KnowledgeExplorer(props) {
  return (
    <ul role="tree" aria-label="Knowledge folders" class="knowledge-tree">
      <Directory
        search={props.search}
        revision={props.revision}
        collapseRevision={props.collapseRevision}
        ancestors={props.ancestors}
        selected={props.selected}
        onSelect={props.onSelect}
        canManage={props.canManage}
        onAddTopic={props.onAddTopic}
        onEditFolder={props.onEditFolder}
        articleLink={props.articleLink}
      />
    </ul>
  );
}
