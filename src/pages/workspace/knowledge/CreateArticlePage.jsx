import ConversationStatus from '../../../components/chat/ConversationStatus.jsx';
import Icon from '../../../components/Icon.jsx';
import ChangeReview from '../../../components/records/ChangeReview.jsx';
import { changedSections } from '../../../utils/textDiff.js';
import { pollConversation } from '../../../services/chat/conversationPolling.js';
import ChatPanelToolbar from '../../../components/chat/ChatPanelToolbar.jsx';
import { followChatProgress } from '../../../services/chat/chatFollow.js';
import ConversationSkeleton from '../../../components/chat/ConversationSkeleton.jsx';
import SplitResizeHandle from '../../../components/SplitResizeHandle.jsx';
import AttachmentPanel from '../../../components/AttachmentPanel.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import { confirmAction } from '../../../services/confirmations.js';
import KnowledgePermissions from '../../../components/knowledge/KnowledgePermissions.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import ChatPrompt from '../../../components/chat/ChatPrompt.jsx';
import { For, Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useSession } from '../../../context/SessionContext.jsx';
import { api } from '../../../services/api.js';
import A from '../../../components/WorkspaceLink.jsx';
import ArticleEditor from '../../../components/knowledge/ArticleEditor.jsx';
import ReferenceLookup from '../../../components/ReferenceLookup.jsx';
import MultiSelectLookup from '../../../components/MultiSelectLookup.jsx';
import ValidatedForm from '../../../components/ValidatedForm.jsx';
import ChatMarkdown from '../../../components/chat/ChatMarkdown.jsx';
import AgentProgress from '../../../components/chat/AgentProgress.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import { workflowChatText } from '../../../services/workflows/workflowChatText.js';
import { useToasts } from '../../../context/ToastContext.jsx';

export default function CreateArticlePage(props) {
  let selectMobilePanel;
  let articleForm;
  const [saveState, setSaveState] = createSignal('Draft');
  const { workspace, refresh, access } = useWorkspace();
  const { session } = useSession();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [query, setQuery] = useSearchParams();
  const [articleId, setArticleId] = createSignal(props.article?.id || '');
  const isCreatingArticle = () => !articleId() || props.article?.isAuthoringDraft === true;
  const isLoadingPlacement = () =>
    !workspace.sectionLoaded('knowledgeBases') || !workspace.sectionLoaded('topics');
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
  const [chatId, setChatId] = createSignal(query.chat || props.article?.authoringChatId || '');
  const [proposal, setProposal] = createSignal(null);
  const [reviewApproved, setReviewApproved] = createSignal(false);
  const [chatBaseline, setChatBaseline] = createSignal(null);
  const [reviewSections, setReviewSections] = createSignal([]);
  const [reviewedResponse, setReviewedResponse] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [chatStarting, setChatStarting] = createSignal(false);
  const isGeneratingArticle = () =>
    chatStarting() || ['queued', 'responding'].includes(currentConversation()?.status);
  const [error, setError] = createSignal('');
  const hasUnpublishedChanges = () =>
    !props.article ||
    status() !== 'Published' ||
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
  createEffect(() => setChatId(query.chat || props.article?.authoringChatId || ''));
  const currentConversation = () =>
    !chatId() || conversation.error || conversation()?.id !== chatId() ? null : conversation();
  let history;
  followChatProgress(
    () => history,
    () => JSON.stringify(currentConversation()?.messages || []),
    () => chatId(),
  );
  pollConversation(() => ['queued', 'responding'].includes(currentConversation()?.status), refetch);
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
    setReviewApproved(false);
  }
  const articleSections = (before, after) => [
    { label: 'Title', before: before.title || '', after: after.title || '' },
    {
      label: 'Attachments',
      before: (before.attachmentIds || []).join('\n'),
      after: (after.attachmentIds || []).join('\n'),
    },
    {
      label: 'Body',
      before: (before.body || '').replace(/></g, '>\n<'),
      after: (after.body || '').replace(/></g, '>\n<'),
    },
    {
      label: 'Knowledge Base',
      before:
        workspace()?.knowledgeBases?.find((item) => item.id === before.knowledgeBaseId)?.name || '',
      after:
        workspace()?.knowledgeBases?.find((item) => item.id === after.knowledgeBaseId)?.name || '',
    },
    {
      label: 'Topics',
      before: (before.topicIds || [])
        .map(
          (id) => workspace()?.topics?.find((item) => item.id === id)?.name || 'Unavailable topic',
        )
        .sort()
        .join('\n'),
      after: (after.topicIds || [])
        .map(
          (id) => workspace()?.topics?.find((item) => item.id === id)?.name || 'Unavailable topic',
        )
        .sort()
        .join('\n'),
    },
  ];
  const savedDraft = () => ({
    title: props.article?.title || '',
    body: props.article?.body || '',
    knowledgeBaseId: props.article?.base || base(),
    topicIds: props.article?.topicIds || topics(),
    attachmentIds: props.article?.attachmentIds || [],
  });
  const hasChatChanges = () => {
    const current = currentConversation();
    const response = current?.messages?.filter((message) => message.role === 'assistant').at(-1);
    return (
      current?.status === 'complete' &&
      response?.id !== reviewedResponse() &&
      !!(current.candidate || response?.proposals?.articleMetadata) &&
      changedSections(
        articleSections(chatBaseline() || savedDraft(), draft(status(), current.candidate)),
      ).length > 0
    );
  };

  async function chat(event) {
    event.preventDefault();
    if (busy() || !prompt().trim()) return;
    setChatBaseline(draft());
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
      if (!articleId() && result.articleId) {
        setArticleId(result.articleId);
        setUpdatedAt(result.articleUpdatedAt);
        await refresh();
        navigate(
          path(
            `/workspace/articles/${result.articleId}/edit?chat=${encodeURIComponent(result.id)}`,
          ),
          { replace: true },
        );
      }
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
  async function review(state = status(), candidate, publishNow = false) {
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
      setReviewSections(
        articleSections(candidate ? chatBaseline() || savedDraft() : savedDraft(), result.draft),
      );
      setProposal(result);
      setReviewApproved(false);
      setTab('preview');
      selectMobilePanel?.('right');
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  let appliedMetadata = '';
  createEffect(() => {
    const current = currentConversation();
    if (current?.status !== 'complete') return;
    const response = current.messages?.filter((message) => message.role === 'assistant').at(-1);
    const metadata = response?.proposals?.articleMetadata;
    if (!metadata || appliedMetadata === response.id) return;
    appliedMetadata = response.id;
    refresh().then(() => {
      if (metadata.knowledgeBaseId) setBase(metadata.knowledgeBaseId);
      setTopics(metadata.topicIds || []);
      changed();
    });
  });
  let previewedResponse = '';
  createEffect(() => {
    const current = currentConversation();
    const candidate = current?.candidate;
    const response = current?.messages?.filter((message) => message.role === 'assistant').at(-1);
    const key =
      candidate && current.status === 'complete' && response ? `${chatId()}:${response.id}` : '';
    if (
      !key ||
      key === previewedResponse ||
      busy() ||
      (!isCreatingArticle() && !base()) ||
      !hasChatChanges()
    )
      return;
    previewedResponse = key;
    if (isCreatingArticle()) {
      setTitle(candidate.title);
      setBody(candidate.body);
    } else review(status(), candidate);
  });
  async function unpublish() {
    if (
      !articleId() ||
      !(await confirmAction(
        'Unpublish this article? It will return to Draft and no longer appear in published knowledge or agent answers.',
        'Unpublish Article',
        'Unpublish',
      ))
    )
      return;
    setBusy(true);
    try {
      const saved = await api(`/api/articles/${articleId()}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Draft' }),
      });
      setStatus('Draft');
      setUpdatedAt(saved.updatedAt);
      await refresh();
      notify({ tone: 'success', message: 'Article unpublished.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  async function finishSave(saved, isNew) {
    setArticleId(saved.id);
    setUpdatedAt(saved.updatedAt);
    setTitle(saved.title);
    setBody(saved.body);
    setBase(saved.base);
    setTopics(saved.topicIds);
    setStatus(saved.status);
    setAttachmentIds(saved.attachmentIds || []);
    setReviewedResponse(
      currentConversation()
        ?.messages?.filter((message) => message.role === 'assistant')
        .at(-1)?.id || '',
    );
    setProposal(null);
    setReviewApproved(false);
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
  }
  function submitNewArticle(state) {
    setSaveState(state);
    setTab('editor');
    queueMicrotask(() => articleForm?.requestSubmit());
  }
  async function saveNewArticle(state) {
    if (busy()) return;
    setBusy(true);
    setError('');
    try {
      const isNew = !articleId();
      const saved = await api(isNew ? '/api/articles' : `/api/articles/${articleId()}`, {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify(draft(state)),
      });
      await finishSave(saved, isNew);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
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
      await finishSave(saved, isNew);
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
            { label: 'Knowledge', href: '/workspace/knowledge?view=articles' },
            base() && {
              label:
                workspace()?.knowledgeBases?.find((item) => item.id === base())?.name ||
                'Knowledge Base',
              href: `/workspace/knowledge/bases/${encodeURIComponent(base())}`,
            },
            topics().length === 1 && {
              label: workspace()?.topics?.find((item) => item.id === topics()[0])?.name || 'Topic',
              href: `/workspace/knowledge?view=articles&base=${encodeURIComponent(base())}&topic=${encodeURIComponent(topics()[0])}`,
            },
            { label: title() || 'New Article' },
          ]}
        />
        <div class="helpdesk-actions">
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={busy() || uploading() || (!proposal() && !articleId())}
            onClick={() =>
              window.open(
                `/preview/${session().user.workspaceId}/${proposal() ? `proposals/${proposal().id}` : `articles/${articleId()}`}`,
                '_blank',
                'noopener,noreferrer',
              )
            }
          >
            Preview
          </button>
          <Show
            when={
              !isCreatingArticle() &&
              (hasChatChanges() ||
                (!reviewApproved() &&
                  changedSections(articleSections(savedDraft(), draft())).length > 0))
            }
          >
            <button
              type="button"
              class="workspace-button secondary small"
              disabled={!canEdit() || busy() || uploading() || isGeneratingArticle()}
              onClick={() =>
                review(status(), hasChatChanges() ? currentConversation().candidate : undefined)
              }
            >
              Review Changes
            </button>
          </Show>
          <Show when={articleId() && status() === 'Published'}>
            <button
              type="button"
              class="workspace-button secondary small"
              disabled={!canEdit() || busy()}
              onClick={unpublish}
            >
              Unpublish
            </button>
          </Show>
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={
              isLoadingPlacement() ||
              !canEdit() ||
              busy() ||
              uploading() ||
              isGeneratingArticle() ||
              (!isCreatingArticle() && !reviewApproved())
            }
            onClick={() => (isCreatingArticle() ? submitNewArticle('Draft') : approve(proposal()))}
          >
            <Icon name="save" />
            Save
          </button>
          <Show when={hasUnpublishedChanges()}>
            <button
              type="button"
              class="workspace-button small"
              disabled={
                isLoadingPlacement() ||
                !canEdit() ||
                busy() ||
                uploading() ||
                isGeneratingArticle() ||
                (!isCreatingArticle() && !reviewApproved())
              }
              onClick={() =>
                isCreatingArticle()
                  ? submitNewArticle('Published')
                  : review('Published', proposal()?.draft, true)
              }
            >
              <Icon name="publish" />

              {status() === 'Published' ? 'Publish Changes' : 'Publish'}
            </button>
          </Show>
        </div>
      </header>
      <Show when={error() || conversation.error}>
        <ToastMessage tone="error">{error() || conversation.error?.message}</ToastMessage>
      </Show>
      <div class="workflow-builder resizable-split">
        <SplitResizeHandle
          storageKey="builder"
          rightLabel="Article"
          onPanelReady={(select) => {
            selectMobilePanel = select;
          }}
        />
        <section class="workflow-chat" aria-label="Article conversation">
          <ChatPanelToolbar
            disabled={isGeneratingArticle()}
            onNewChat={() => {
              setChatId('');
              setQuery({ chat: undefined });
              setPrompt('');
              setProposal(null);
              setReviewApproved(false);
            }}
          />
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
                      toolCalls={message.toolCalls || []}
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
                    {
                      label: 'Status',
                      render: (item) => <ConversationStatus status={item.status} />,
                    },
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
                ref={(element) => {
                  articleForm = element;
                }}
                class="create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isCreatingArticle()) saveNewArticle(saveState());
                  else review();
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
                    .filter((item) => props.article?.demoDatasetId || !item.demoDatasetId)
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
                    .filter((item) => props.article?.demoDatasetId || !item.demoDatasetId)
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
                  fallback={
                    <>
                      <h1>
                        {(isCreatingArticle() ? title() : props.article?.title) ||
                          'Untitled article'}
                      </h1>
                      <ArticleEditor
                        readOnly
                        content={(isCreatingArticle() ? body() : props.article?.body) || ''}
                      />
                    </>
                  }
                >
                  {(item) => (
                    <>
                      <div class="article-review-bar">
                        <p class="article-approval-notice">
                          {reviewApproved()
                            ? 'Changes approved. Save or publish when ready.'
                            : 'Review these changes before approving. Your saved article has not changed.'}
                        </p>
                        <Show when={!reviewApproved()}>
                          <div class="article-approval-actions">
                            <button
                              type="button"
                              class="workspace-button secondary small"
                              disabled={busy()}
                              onClick={() => {
                                setReviewedResponse(
                                  currentConversation()
                                    ?.messages?.filter((message) => message.role === 'assistant')
                                    .at(-1)?.id || '',
                                );
                                setProposal(null);
                                setReviewApproved(false);
                              }}
                            >
                              Reject Changes
                            </button>
                            <button
                              type="button"
                              class="workspace-button small"
                              disabled={busy() || item().status !== 'pending'}
                              onClick={() => {
                                setTitle(item().draft.title);
                                setBody(item().draft.body);
                                setReviewedResponse(
                                  currentConversation()
                                    ?.messages?.filter((message) => message.role === 'assistant')
                                    .at(-1)?.id || '',
                                );
                                setReviewApproved(true);
                              }}
                            >
                              <Icon name="check" />
                              Approve Changes
                            </button>
                          </div>
                        </Show>
                      </div>
                      <Show when={!reviewApproved()}>
                        <ChangeReview sections={reviewSections()} />
                      </Show>
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
