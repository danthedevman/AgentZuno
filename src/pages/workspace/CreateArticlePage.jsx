import { followChatProgress } from '../../services/chatFollow.js';
import ConversationSkeleton from '../../components/ConversationSkeleton.jsx';
import SplitResizeHandle from '../../components/SplitResizeHandle.jsx';
import AttachmentPanel from '../../components/AttachmentPanel.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import { confirmAction } from '../../services/confirmations.js';
import KnowledgePermissions from '../../components/KnowledgePermissions.jsx';
import RecordTable from '../../components/RecordTable.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import ChatPrompt from '../../components/ChatPrompt.jsx';
import { For, Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import { api } from '../../services/api.js';
import A from '../../components/WorkspaceLink.jsx';
import ArticleEditor from '../../components/ArticleEditor.jsx';
import ReferenceLookup from '../../components/ReferenceLookup.jsx';
import MultiSelectLookup from '../../components/MultiSelectLookup.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import ChatMarkdown from '../../components/ChatMarkdown.jsx';
import AgentProgress from '../../components/AgentProgress.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import { workflowChatText } from '../../services/workflowChatText.js';
import { useToasts } from '../../context/ToastContext.jsx';

export default function CreateArticlePage(props) {
  const { workspace, refresh, access } = useWorkspace();
  const { session } = useSession();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [query, setQuery] = useSearchParams();
  const [articleId, setArticleId] = createSignal(props.article?.id || '');
  const [updatedAt, setUpdatedAt] = createSignal(props.article?.updatedAt || null);
  const [title, setTitle] = createSignal(props.article?.title || '');
  const [body, setBody] = createSignal(props.article?.body || '');
  const [base, setBase] = createSignal(props.article?.base || query.base || '');
  const [topics, setTopics] = createSignal(
    props.article?.topicIds || (query.topic ? [query.topic] : []),
  );
  const [attachmentIds, setAttachmentIds] = createSignal(props.article?.attachmentIds || []);
  const [newAttachments, setNewAttachments] = createSignal([]);
  const [status, setStatus] = createSignal(props.article?.status || 'Draft');
  const [tab, setTab] = createSignal('editor');
  const [prompt, setPrompt] = createSignal('');
  const [chatId, setChatId] = createSignal(query.chat || '');
  const [proposal, setProposal] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [chatStarting, setChatStarting] = createSignal(false);
  const isGeneratingArticle = () =>
    chatStarting() || ['queued', 'responding'].includes(currentConversation()?.status);
  const [error, setError] = createSignal('');
  const hasUnpublishedChanges = () =>
    !props.article ||
    props.article.status !== 'Published' ||
    title() !== props.article.title ||
    body() !== props.article.body ||
    base() !== props.article.base ||
    JSON.stringify(topics()) !== JSON.stringify(props.article.topicIds || []) ||
    JSON.stringify(attachmentIds()) !== JSON.stringify(props.article.attachmentIds || []);
  const canEdit = () => !access.error && access()?.role === 'admin';
  const [conversation, { refetch }] = createResource(
    () => chatId() || false,
    (id) => api(`/api/helpdesk/article-conversations/${id}`),
  );
  createEffect(() => setChatId(query.chat || ''));
  const currentConversation = () =>
    !chatId() || conversation.error || conversation()?.id !== chatId() ? null : conversation();
  createEffect(() => {
    if (!base() && !query.base && workspace()?.knowledgeBases?.length)
      setBase(
        workspace().knowledgeBases.find(
          (item) => props.article.demoDatasetId || !item.demoDatasetId,
        )?.id || '',
      );
  });
  let history;
  followChatProgress(
    () => history,
    () => JSON.stringify(currentConversation()?.messages || []),
  );
  createEffect(() => {
    if (!['queued', 'responding'].includes(currentConversation()?.status)) return;
    const timer = setTimeout(() => refetch(), 500);
    onCleanup(() => clearTimeout(timer));
  });
  const [storedAttachments] = createResource(
    () => (['attachments', 'preview'].includes(tab()) && articleId()) || false,
    (id) => api(`/api/helpdesk/article-attachment-list/${id}`),
  );
  const attachments = () =>
    [...(storedAttachments.error ? [] : storedAttachments() || []), ...newAttachments()].filter(
      (item, index, all) =>
        attachmentIds().includes(item.id) &&
        all.findIndex((value) => value.id === item.id) === index,
    );
  async function addAttachments(files) {
    if (uploading() || busy()) return;
    if (files.length + attachmentIds().length > 10) {
      setError('Attach up to 10 files per article.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      for (const file of files) {
        const saved = await api('/api/helpdesk/article-attachments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
        setNewAttachments((items) => [...items, saved]);
        setAttachmentIds((ids) => [...ids, saved.id]);
        changed();
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setUploading(false);
    }
  }
  const draft = (state = status(), candidate) => ({
    title: candidate?.title ?? title(),
    body: candidate?.body ?? body(),
    knowledgeBaseId: base(),
    topicIds: topics(),
    status: state,
    attachmentIds: attachmentIds(),
  });
  function changed() {
    setProposal(null);
  }
  async function chat(event) {
    event.preventDefault();
    if (busy() || !prompt().trim()) return;
    setBusy(true);
    setChatStarting(true);
    setTab('preview');
    setError('');
    try {
      const result = await api(
        chatId()
          ? `/api/helpdesk/article-conversations/${chatId()}/messages`
          : '/api/helpdesk/article-conversations',
        {
          method: 'POST',
          body: JSON.stringify({
            text: prompt(),
            draft: { title: title(), body: body() },
            ...(chatId()
              ? {}
              : { requestId: crypto.randomUUID(), articleId: articleId() || undefined }),
          }),
        },
      );
      setChatId(result.id);
      setQuery({ chat: result.id });
      setPrompt('');
      await refetch();
      requestAnimationFrame(() => {
        if (history) history.scrollTop = history.scrollHeight;
      });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
      setChatStarting(false);
    }
  }
  async function review(state = status(), candidate, standalone = false, publishNow = false) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/helpdesk/article-proposals', {
        method: 'POST',
        body: JSON.stringify({
          articleId: articleId() || undefined,
          expectedUpdatedAt: updatedAt(),
          chatId: chatId() || undefined,
          draft: draft(state, candidate),
        }),
      });
      if (publishNow) {
        await approve(result);
        return;
      }
      setProposal(result);
      setTab('preview');
      if (standalone)
        window.open(
          `/preview/${session().user.workspaceId}/proposals/${result.id}`,
          '_blank',
          'noopener',
        );
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  let previewedResponse = '';
  createEffect(() => {
    const current = currentConversation();
    const candidate = current?.candidate;
    const response = current?.messages?.filter((message) => message.role === 'assistant').at(-1);
    const key =
      candidate && current.status === 'complete' && response ? `${chatId()}:${response.id}` : '';
    if (!key || key === previewedResponse || busy() || !base()) return;
    previewedResponse = key;
    review(status(), candidate);
  });
  async function approve(candidate) {
    const approvedProposal = candidate?.id ? candidate : proposal();
    setBusy(true);
    setError('');
    try {
      const isNew = !articleId();
      const saved = await api(`/api/helpdesk/article-proposals/${approvedProposal.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approved: true }),
      });
      setArticleId(saved.id);
      setUpdatedAt(saved.updatedAt);
      setTitle(saved.title);
      setBody(saved.body);
      setBase(saved.base);
      setTopics(saved.topicIds);
      setStatus(saved.status);
      setAttachmentIds(saved.attachmentIds || []);
      setProposal(null);
      setTab('editor');
      await refresh();
      if (isNew)
        navigate(
          path(
            `/workspace/articles/${saved.id}/edit${chatId() ? `?chat=${encodeURIComponent(chatId())}` : ''}`,
          ),
          { replace: true },
        );
      notify({
        tone: 'success',
        message: saved.status === 'Published' ? 'Article published.' : 'Article saved.',
      });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="workflow-page is-builder article-builder">
      <header class="workflow-builder-heading">
        <Breadcrumbs
          label="Article location"
          items={[
            { label: 'Knowledge', href: '/workspace/knowledge?tab=articles' },
            base() && {
              label:
                workspace()?.knowledgeBases?.find((item) => item.id === base())?.name ||
                'Knowledge Base',
              href: `/workspace/knowledge/bases/${encodeURIComponent(base())}`,
            },
            topics().length === 1 && {
              label: workspace()?.topics?.find((item) => item.id === topics()[0])?.name || 'Topic',
              href: `/workspace/knowledge?tab=articles&base=${encodeURIComponent(base())}&topic=${encodeURIComponent(topics()[0])}`,
            },
            { label: title() || 'New Article' },
          ]}
        />
        <div class="helpdesk-actions">
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={busy() || uploading()}
            onClick={() => review(status(), undefined, true)}
          >
            Preview
          </button>
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={!canEdit() || busy() || uploading() || isGeneratingArticle()}
            onClick={() => review()}
          >
            Review Changes
          </button>
          <Show when={hasUnpublishedChanges()}>
            <button
              type="button"
              class="workspace-button small"
              disabled={!canEdit() || busy() || uploading() || isGeneratingArticle()}
              onClick={() => review('Published', proposal()?.draft, false, true)}
            >
              {props.article?.status === 'Published' ? 'Publish Changes' : 'Publish'}
            </button>
          </Show>
        </div>
      </header>
      <Show when={error() || conversation.error}>
        <ToastMessage tone="error">{error() || conversation.error?.message}</ToastMessage>
      </Show>
      <div class="workflow-builder resizable-split">
        <SplitResizeHandle storageKey="builder" />
        <section class="workflow-chat" aria-label="Article conversation">
          <div ref={history} class="workflow-chat-history">
            <Show when={chatId() && conversation.loading && !currentConversation()}>
              <ConversationSkeleton />
            </Show>
            <For each={currentConversation()?.messages || []}>
              {(message) => (
                <article class={`workflow-chat-message ${message.role}`}>
                  <strong>{message.role === 'user' ? 'You' : 'Admin Agent'}</strong>
                  <ChatMarkdown
                    text={
                      message.role === 'assistant' ? workflowChatText(message.text) : message.text
                    }
                  />
                  <Show when={message.role === 'assistant'}>
                    <AgentProgress
                      events={message.progress || []}
                      phase={message.phase || message.status}
                    />
                  </Show>
                  <Show when={message.error}>
                    <p>{message.error}</p>
                  </Show>
                </article>
              )}
            </For>
            <Show when={currentConversation()?.candidate}>
              <button
                type="button"
                class="workspace-button secondary"
                disabled={busy()}
                onClick={() => review(status(), currentConversation().candidate)}
              >
                Review Proposed Article
              </button>
            </Show>
          </div>
          <div class="article-chat-composer">
            <ChatPrompt
              value={prompt()}
              onInput={setPrompt}
              placeholder="Describe the article or ask for changes…"
              disabled={
                !canEdit() ||
                busy() ||
                ['queued', 'responding'].includes(currentConversation()?.status)
              }
              onSubmit={chat}
            />
          </div>
        </section>
        <section class="workflow-design" aria-label="Article draft">
          <div class="workflow-tabs" role="tablist" aria-label="Article views">
            <For each={['editor', 'preview', 'attachments', 'history', 'permissions']}>
              {(value) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === value}
                  onClick={() => setTab(value)}
                >
                  {value === 'editor'
                    ? 'Editor'
                    : value === 'preview'
                      ? 'Preview'
                      : value === 'history'
                        ? 'History'
                        : value === 'attachments'
                          ? 'Attachments'
                          : 'Permissions'}
                </button>
              )}
            </For>
          </div>
          <div class="article-builder-content">
            <Show when={tab() === 'attachments'}>
              <AttachmentPanel
                files={attachments().map((file) => ({
                  ...file,
                  href: `/api/helpdesk/article-attachments/${file.id}?workspace=${session()?.user?.workspaceId}${articleId() && !newAttachments().some((item) => item.id === file.id) ? `&article=${articleId()}` : ''}`,
                }))}
                busy={uploading() || busy()}
                loading={storedAttachments.loading}
                onFiles={canEdit() ? addAttachments : undefined}
                onRemove={
                  canEdit()
                    ? async (file) => {
                        if (
                          await confirmAction(
                            `Remove “${file.name}” from this article?`,
                            'Remove Attachment',
                            'Remove',
                          )
                        ) {
                          setAttachmentIds((ids) => ids.filter((id) => id !== file.id));
                          changed();
                        }
                      }
                    : undefined
                }
              />
            </Show>
            <Show when={tab() === 'permissions'}>
              <Show when={articleId()} fallback={<p>Save the article to configure permissions.</p>}>
                <KnowledgePermissions kind="article" id={articleId()} />
              </Show>
            </Show>
            <Show when={tab() === 'history'}>
              <Show
                when={articleId()}
                fallback={
                  <div class="record-empty-state">
                    <h3>Save the article to keep its conversation history here.</h3>
                  </div>
                }
              >
                <RecordTable
                  label="Conversations"
                  source={`/api/helpdesk/article-conversations?articleId=${encodeURIComponent(articleId())}`}
                  columns={[
                    { label: 'Conversation', render: (item) => item.title },
                    { label: 'Status', render: (item) => item.status },
                    {
                      label: 'Updated',
                      render: (item) => new Date(item.updatedAt).toLocaleString(),
                    },
                  ]}
                  defaultSort={{ key: 'Updated', direction: 'desc' }}
                  emptyText="No conversations yet."
                  onOpen={(item) => {
                    setChatId(item.id);
                    setQuery({ chat: item.id });
                    setTab('editor');
                  }}
                />
              </Show>
            </Show>
            <Show when={tab() === 'editor'}>
              <ValidatedForm
                class="create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  review();
                }}
              >
                <label>
                  Title
                  <input
                    name="title"
                    required
                    maxlength="160"
                    value={title()}
                    onInput={(event) => {
                      setTitle(event.currentTarget.value);
                      changed();
                    }}
                  />
                </label>
                <ReferenceLookup
                  label="Knowledge Base"
                  name="knowledgeBaseId"
                  required
                  value={base()}
                  options={(workspace()?.knowledgeBases || [])
                    .filter((item) => props.article.demoDatasetId || !item.demoDatasetId)
                    .map((item) => ({
                      value: item.id,
                      href: `/workspace/knowledge/bases/${item.id}`,
                      label: item.name,
                    }))}
                  onChange={(value) => {
                    setBase(value);
                    changed();
                  }}
                />
                <MultiSelectLookup
                  label="Topics"
                  required
                  name="topicIds"
                  value={topics()}
                  options={(workspace()?.topics || [])
                    .filter((item) => props.article.demoDatasetId || !item.demoDatasetId)
                    .map((item) => ({
                      value: item.id,
                      href: `/workspace/records/topic/${item.id}/edit`,
                      label: item.name,
                    }))}
                  onChange={(value) => {
                    setTopics(value);
                    changed();
                  }}
                />

                <label>Body</label>
                <ArticleEditor
                  content={body()}
                  canUpload
                  onChange={(value) => {
                    setBody(value.html);
                    changed();
                  }}
                  onUploading={setUploading}
                />
              </ValidatedForm>
            </Show>
            <Show when={tab() === 'preview'}>
              <Show when={isGeneratingArticle() || (busy() && !proposal())}>
                <div class="article-generation-placeholder" role="status">
                  <span>Generating article…</span>
                  <Skeleton label="Generating article title" lines={1} />
                  <Skeleton label="Generating article body" lines={8} />
                </div>
              </Show>
              <Show when={!isGeneratingArticle() && !(busy() && !proposal())}>
                <Show
                  when={proposal()}
                  fallback={<p>Review your changes to prepare an article preview.</p>}
                >
                  {(item) => (
                    <>
                      <p class="article-approval-notice">
                        Review this {item().draft.status.toLowerCase()} article before approving.
                        Your saved article has not changed.
                      </p>
                      <h1>{item().draft.title}</h1>
                      <ArticleEditor readOnly content={item().draft.body} />
                      <Show when={item().draft.attachmentIds?.length}>
                        <h2>Attachments</h2>
                        <For
                          each={attachments().filter((file) =>
                            item().draft.attachmentIds.includes(file.id),
                          )}
                        >
                          {(file) => <p>{file.name}</p>}
                        </For>
                      </Show>
                      <div class="article-approval-actions">
                        <button
                          type="button"
                          class="workspace-button"
                          disabled={busy() || item().status !== 'pending'}
                          onClick={approve}
                        >
                          Approve &amp; {item().draft.status === 'Published' ? 'Publish' : 'Save'}
                        </button>
                        <button
                          type="button"
                          class="workspace-button secondary"
                          disabled={busy()}
                          onClick={() => {
                            setProposal(null);
                            setTab('editor');
                          }}
                        >
                          Reject Changes
                        </button>
                        <a
                          href={`/preview/${session()?.user?.workspaceId}/proposals/${item().id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open Standalone Preview
                        </a>
                      </div>
                    </>
                  )}
                </Show>
              </Show>
            </Show>
          </div>
        </section>
      </div>
    </section>
  );
}
