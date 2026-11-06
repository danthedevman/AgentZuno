import Breadcrumbs from '../Breadcrumbs.jsx';
import ToastMessage from '../ToastMessage.jsx';
import { For, Show, createSignal, createUniqueId } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';
import Dropdown from '../Dropdown.jsx';
import { contentStatus } from '../../services/contentStatus.js';

const states = ['Draft', 'Review', 'Published'];
const dateLabel = (value) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
};

export default function ArticleLayout(props) {
  const { workspace, access } = useWorkspace();
  const panelId = createUniqueId();
  const [isCollapsed, setIsCollapsed] = createSignal(
    (() => {
      try {
        const preference = localStorage.getItem('agentzuno-article-panel');
        return preference
          ? preference === 'collapsed'
          : window.matchMedia('(max-width: 760px)').matches;
      } catch {
        return false;
      }
    })(),
  );
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const article = () => props.article || {};
  const status = () =>
    contentStatus({ type: 'Article', status: props.status || article().status || 'Draft' });
  const base = () =>
    workspace()?.knowledgeBases.find(
      (item) => item.id === (article().base || article().knowledgeBaseId),
    );
  const topics = () =>
    (workspace()?.topics || []).filter(
      (topic) =>
        article().topicIds?.includes(topic.id) ||
        (!article().topicIds && topic.articleIds?.includes(article().id)),
    );
  function togglePanel() {
    const next = !isCollapsed();
    setIsCollapsed(next);
    try {
      localStorage.setItem('agentzuno-article-panel', next ? 'collapsed' : 'open');
    } catch {}
  }
  function changeStatus(value) {
    if (props.canEdit && props.onStatusChange && !props.isSaving) props.onStatusChange(value);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('Link copied.');
    } catch {
      setError('Could not copy the link. Copy it from your browser address bar.');
    }
  }
  return (
    <div class="article-layout" classList={{ 'article-panel-collapsed': isCollapsed() }}>
      <div class="article-main-content">
        <Show when={!props.isPublic && base()}>
          <Breadcrumbs
            class="article-breadcrumbs"
            label="Article location"
            items={[
              { label: 'Knowledge', href: '/workspace/knowledge' },
              {
                label: base().name,
                href:
                  access()?.role === 'admin'
                    ? `/workspace/knowledge/bases/${encodeURIComponent(base().id)}`
                    : `/workspace/knowledge?base=${encodeURIComponent(base().id)}`,
              },
              topics().length === 1 && {
                label: topics()[0].name,
                href: `/workspace/knowledge?${access()?.role === 'admin' ? 'tab=articles&' : ''}base=${encodeURIComponent(base().id)}&topic=${encodeURIComponent(topics()[0].id)}`,
              },
              { label: article().title || 'New Article' },
            ]}
          />
        </Show>
        {props.children}
      </div>
      <aside class="article-details-panel" aria-label="Article details">
        <div class="article-panel-heading">
          <button
            class="article-icon-button"
            type="button"
            aria-label={isCollapsed() ? 'Expand article details' : 'Collapse article details'}
            title={isCollapsed() ? 'Expand article details' : 'Collapse article details'}
            aria-expanded={!isCollapsed()}
            aria-controls={panelId}
            onClick={togglePanel}
          >
            <Icon name="panel" />
          </button>
          <Show when={!isCollapsed()}>
            <h2>Article details</h2>
          </Show>
        </div>
        <div id={panelId} class="article-panel-content" hidden={isCollapsed()}>
          <section class="article-panel-actions">
            <h3>Actions</h3>
            <Show when={props.canEdit && !props.onStatusChange}>
              <A class="workspace-button" href={`/workspace/articles/${article().id}/edit`}>
                <Icon name="edit" />
                Edit article
              </A>
            </Show>
            <Show when={props.onStatusChange}>
              <button
                class="workspace-button"
                type="submit"
                form="article-form"
                disabled={props.isSaveDisabled}
              >
                <Icon name="check" />
                {props.isSaving ? 'Saving…' : 'Save article'}
              </button>
            </Show>
            <Show when={props.onStatusChange}>
              <A
                class="workspace-button secondary"
                href={
                  article().id
                    ? `/workspace/articles/${article().id}`
                    : '/workspace/knowledge?view=articles'
                }
              >
                Cancel
              </A>
            </Show>
            <Show when={article().id && !props.onStatusChange}>
              <button class="workspace-button secondary" type="button" onClick={copyLink}>
                <Icon name="link" />
                Copy link
              </button>
            </Show>
            <Show when={article().sourceUrl}>
              <a
                class="workspace-button secondary"
                href={article().sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="arrow" />
                Open source
              </a>
            </Show>
            <A class="workspace-button secondary" href="/workspace/knowledge?view=articles">
              <Icon name="book-pen" />
              Browse articles
            </A>
          </section>
          <section>
            <h3>Status</h3>
            <Show
              when={props.canEdit && !!props.onStatusChange}
              fallback={
                <span class="activity-status" data-tone={status().tone}>
                  <span class="status-dot" />
                  {props.isImported ? 'Source managed' : status().label}
                </span>
              }
            >
              <Dropdown
                ariaLabel="Article status"
                icon="task"
                value={props.status || article().status || 'Draft'}
                options={states.map((value) => ({ value, label: value }))}
                onChange={changeStatus}
                disabled={props.isSaving}
              />
              <Show when={props.onStatusChange}>
                <small>Status is applied when you save.</small>
              </Show>
            </Show>
          </section>
          <section>
            <h3>Details</h3>
            <dl>
              <dt>Knowledge base</dt>
              <dd>
                <Show when={base()} fallback="Not recorded">
                  {(item) => (
                    <A
                      href={`/workspace/knowledge?view=articles&base=${encodeURIComponent(item().id)}`}
                    >
                      {item().name}
                    </A>
                  )}
                </Show>
              </dd>
              <dt>Topics</dt>
              <dd>
                <Show when={topics().length} fallback="None">
                  <div class="article-panel-topics">
                    <For each={topics()}>
                      {(topic) => (
                        <A
                          href={`/workspace/knowledge?view=articles&topic=${encodeURIComponent(topic.id)}`}
                        >
                          {topic.name}
                        </A>
                      )}
                    </For>
                  </div>
                </Show>
              </dd>
              <dt>Created</dt>
              <dd>{dateLabel(article().createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{dateLabel(article().updatedAt)}</dd>
              <dt>Access</dt>
              <dd>
                {props.isImported
                  ? article().permissionMode === 'source'
                    ? 'Source permissions'
                    : 'Private managed copy'
                  : props.isPublic
                    ? 'Public guide'
                    : 'Your workspace'}
              </dd>
            </dl>
          </section>

          <Show when={message()}>
            <ToastMessage tone="success" message={message()} />
          </Show>
          <Show when={error()}>
            <ToastMessage tone="error">{error()}</ToastMessage>
          </Show>
        </div>
      </aside>
    </div>
  );
}
