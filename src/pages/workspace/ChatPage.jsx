import { followChatProgress } from '../../services/chatFollow.js';
import ConversationSkeleton from '../../components/ConversationSkeleton.jsx';
import SplitResizeHandle from '../../components/SplitResizeHandle.jsx';
import ArticleReader from '../../components/ArticleReader.jsx';
import RequestChatAction from '../../components/RequestChatAction.jsx';
import ContentTransition from '../../components/ContentTransition.jsx';
import ArticleAttachments from '../../components/ArticleAttachments.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import ArticleEditor from '../../components/ArticleEditor.jsx';
import RequestPanel from '../../components/RequestPanel.jsx';
import Dropdown from '../../components/Dropdown.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import RequestForm from '../../components/RequestForm.jsx';
import ChatMarkdown from '../../components/ChatMarkdown.jsx';
import { createStore, reconcile } from 'solid-js/store';
import Icon from '../../components/Icon.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import { For, Show, createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import { useSession } from '../../context/SessionContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { api } from '../../services/api.js';
import A from '../../components/WorkspaceLink.jsx';
import ChatPrompt from '../../components/ChatPrompt.jsx';
import AgentProgress from '../../components/AgentProgress.jsx';

export default function ChatPage() {
  const { access } = useWorkspace();
  const isReadOnly = () => access()?.role === 'read-only';
  const { session } = useSession();
  const params = useParams();
  const [query, setQuery] = useSearchParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const supportPath = '/api/helpdesk/support/conversations';
  const [chatSettings] = createResource(
    () => !!session()?.user,
    () => api('/api/helpdesk/chat-settings'),
  );
  const [articleId, setArticleId] = createSignal('');
  const [readingArticle] = createResource(articleId, (id) =>
    api(`/api/helpdesk/knowledge-center?article=${encodeURIComponent(id)}`),
  );
  const [requestActionsTarget, setRequestActionsTarget] = createSignal();
  const [requestLocationTarget, setRequestLocationTarget] = createSignal();
  const hasSidePanel = () => !!activeRequest() || !!articleId();
  createEffect(() => {
    params.id;
    setArticleId('');
  });
  function openReferencedArticle(event) {
    const anchor = event.target.closest('a[href]');
    if (
      !anchor ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const url = new URL(anchor.href, window.location.href);
    const match = url.pathname.match(/^\/workspace\/([^/]+)\/articles\/([a-f0-9]{24})$/);
    if (url.origin !== window.location.origin || !match || match[1] !== params.workspaceId) return;
    event.preventDefault();
    setArticleId(match[2]);
  }
  const [selectedRequest, setSelectedRequest] = createSignal(query.request || '');
  const activeRequest = () =>
    current()?.requests?.find((item) => item.id === selectedRequest()) ||
    current()?.requests?.at(-1);
  const [prompt, setPrompt] = createSignal('');
  const [attachments, setAttachments] = createSignal([]);
  const [uploading, setUploading] = createSignal(false);
  const [uploadStatus, setUploadStatus] = createSignal('');
  async function uploadFiles(files) {
    if (uploading() || busy()) return;
    if (files.length + attachments().length > 5) {
      setError('Attach up to five files per message.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      for (const [index, file] of files.entries()) {
        setUploadStatus(`Uploading file ${index + 1} of ${files.length}: ${file.name}`);
        if (!/\.(txt|md|csv|json|log)$/i.test(file.name) || file.size > 100000 || !file.size)
          throw new Error('Choose TXT, Markdown, CSV, JSON, or LOG files up to 100 KB each.');
        const saved = await api('/api/helpdesk/chat-attachments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
        setAttachments((items) => [...items, saved]);
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setUploading(false);
      setUploadStatus('');
    }
  }

  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [nextCursor, setNextCursor] = createSignal(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  let historySentinel;
  const [chats, { refetch: refreshChats, mutate: updateChats }] = createResource(
    () => !!session()?.user && !session().user.isDemo,
    async () => {
      const result = await api(supportPath);
      setNextCursor(result.nextCursor);
      return result.items;
    },
  );
  const [recentChats, setRecentChats] = createStore([]);
  createEffect(() => {
    if (!chats.error) setRecentChats(reconcile(chats() || [], { key: 'id' }));
  });
  async function loadMoreChats() {
    if (!nextCursor() || loadingMore()) return;
    const cursor = nextCursor();
    setLoadingMore(true);
    try {
      const result = await api(`${supportPath}?cursor=${encodeURIComponent(cursor)}`);
      updateChats((items) => [
        ...new Map([...(items || []), ...result.items].map((item) => [item.id, item])).values(),
      ]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoadingMore(false);
    }
  }
  createEffect(() => {
    chats()?.length;
    if (!historySentinel || !nextCursor()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreChats();
      },
      { rootMargin: '100px' },
    );
    observer.observe(historySentinel);
    onCleanup(() => observer.disconnect());
  });
  const [chat, { refetch: refreshChat, mutate }] = createResource(
    () => (session()?.user && params.id ? `${params.id}:${query.request || ''}` : false),
    () =>
      api(
        `${supportPath}/${params.id}${query.request ? `?request=${encodeURIComponent(query.request)}` : ''}`,
      ),
  );
  const [conversation, setConversation] = createStore({ messages: [] });
  createEffect(() => {
    const result = chat();
    if (result) setConversation(reconcile(result, { key: 'id' }));
  });
  const current = () => (chat.error || conversation.id !== params.id ? null : conversation);
  const busy = () => sending() || ['queued', 'responding'].includes(current()?.status);
  const [pendingMessage, setPendingMessage] = createSignal('');
  let timer;
  let messageList;
  followChatProgress(
    () => messageList,
    () =>
      JSON.stringify({
        id: params.id,
        messages: current()?.messages,
        form: current()?.requestForm,
        progress: current()?.progress,
      }),
    () => params.id,
  );
  let resumed = false;
  let openedRequestChat = '';
  createEffect(() => {
    const key = params.id && activeRequest() ? `${params.id}:${activeRequest().id}` : '';
    if (!key || key === openedRequestChat || chat.loading || !current()?.messages?.length) return;
    openedRequestChat = key;
    requestAnimationFrame(() => {
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
  });
  onCleanup(() => clearTimeout(timer));
  createEffect(() => {
    chat();
    clearTimeout(timer);
    if (['queued', 'responding'].includes(current()?.status))
      timer = setTimeout(() => refreshChat().catch(() => {}), 500);
  });
  createEffect(() => {
    if (!pendingMessage()) return;
    requestAnimationFrame(() => {
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
  });
  createEffect(() => {
    if (!session.loading && params.id && !session()?.user)
      navigate(`/login?next=chat&chat=${encodeURIComponent(params.id)}`, { replace: true });
    if (!session()?.user || params.id || !query.draft || resumed) return;
    resumed = true;
    try {
      const key = `agentzuno-chat-draft-${query.draft}`;
      const draft = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!draft || draft.expiresAt < Date.now() || typeof draft.text !== 'string') {
        sessionStorage.removeItem(key);
        return;
      }
      setPrompt(draft.text);
      submitMessage(draft.requestId, key);
    } catch {
      setError('Your draft could not be restored. Please enter your message again.');
    }
  });
  async function submitMessage(requestId = crypto.randomUUID(), draftKey) {
    const text =
      prompt().trim() || (attachments().length ? 'Please review the attached files.' : '');
    if (!text || text.length > 7000 || busy() || uploading()) return;
    setError('');
    if (!session()?.user) {
      try {
        sessionStorage.setItem(
          `agentzuno-chat-draft-${requestId}`,
          JSON.stringify({ text, requestId, expiresAt: Date.now() + 30 * 60000 }),
        );
        navigate(`/login?next=chat&draft=${requestId}`);
      } catch {
        setError('Enable browser session storage to preserve your message through sign-in.');
      }
      return;
    }
    setSending(true);
    setPendingMessage(text);

    try {
      const result = await api(params.id ? `${supportPath}/${params.id}/messages` : supportPath, {
        method: 'POST',
        body: JSON.stringify({
          text,
          attachmentIds: attachments().map((file) => file.id),
          ...(activeRequest() ? { activeRequestId: activeRequest().id } : {}),
          ...(!params.id ? { requestId } : {}),
        }),
      });
      if (draftKey) sessionStorage.removeItem(draftKey);
      setPrompt('');
      setAttachments([]);
      if (params.id) await refreshChat();
      else navigate(path(`/workspace/chat/${result.id}`), { replace: true });
      refreshChats();
    } catch (error) {
      setError(error.message);
    } finally {
      setPendingMessage('');
      setSending(false);
    }
  }
  async function retry() {
    setSending(true);
    setError('');
    try {
      mutate(
        await api(`${supportPath}/${params.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ retry: true }),
        }),
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <section
      classList={{
        'chat-page': true,
        'is-conversation': !!params.id,
        'has-request-panel': hasSidePanel(),
        'is-operator': current()?.operatorView === true,
      }}
      aria-label="Chat"
    >
      <Show
        when={params.id}
        fallback={
          <div class="chat-welcome">
            <h1>
              <Show
                when={!chatSettings.loading}
                fallback={<Skeleton label="Loading greeting" lines={1} />}
              >
                <span class="content-reveal-inline">
                  {(!chatSettings.error && chatSettings()?.greeting) || 'How can I help you?'}
                </span>
              </Show>
            </h1>

            <ChatPrompt
              autoFocus
              attachments={attachments()}
              uploading={uploading()}
              uploadStatus={uploadStatus()}
              onFiles={uploadFiles}
              onRemoveFile={(id) =>
                setAttachments((items) => items.filter((file) => file.id !== id))
              }
              value={prompt()}
              onInput={setPrompt}
              disabled={sending() || isReadOnly()}
              readOnly={isReadOnly()}
              onSubmit={(event) => {
                event.preventDefault();
                submitMessage();
              }}
            />
            <div class="chat-history">
              <Show when={chats.loading || recentChats.length > 0}>
                <h2>Recent Chats</h2>
              </Show>

              <Show when={chats.error}>
                <ToastMessage tone="error">{chats.error.message}</ToastMessage>
              </Show>
              <ContentTransition
                ready={!!chats() || !!chats.error}
                class="recent-chat-items"
                fallback={
                  <Skeleton
                    class="recent-chat-placeholder"
                    label="Loading recent chats"
                    lines={3}
                  />
                }
              >
                <For each={recentChats}>
                  {(item) => <A href={`/workspace/chat/${item.id}`}>{item.title}</A>}
                </For>
                <Show when={nextCursor()}>
                  <div ref={historySentinel}>
                    <button
                      class="card-link"
                      type="button"
                      onClick={loadMoreChats}
                      disabled={loadingMore()}
                    >
                      {loadingMore() ? 'Loading chats…' : 'Load more chats'}
                    </button>
                  </div>
                </Show>
              </ContentTransition>
            </div>
          </div>
        }
      >
        <div class="chat-conversation-layout resizable-split">
          <section class="chat-conversation-left">
            <div class="chat-thread-heading">
              <h1>{current()?.title || 'Chat'}</h1>
            </div>
            <Show when={chat.error}>
              <ToastMessage tone="error">
                This chat could not be loaded. It may belong to another workspace.
              </ToastMessage>
            </Show>
            <div
              class="chat-messages"
              ref={messageList}
              onWheel={() => setResponseReveal(null)}
              onTouchStart={() => setResponseReveal(null)}
              role="log"
              aria-label="Chat messages"
              aria-live="polite"
              aria-relevant="additions text"
            >
              <Show when={chat.loading && !current()}>
                <ConversationSkeleton />
              </Show>
              <For each={current()?.messages || []}>
                {(message) => (
                  <article
                    data-message-id={message.id}
                    classList={{
                      'chat-message': true,
                      'from-user': message.role === 'user',
                      'is-typing':
                        message.role === 'assistant' &&
                        !message.text &&
                        ['queued', 'responding'].includes(message.status),
                    }}
                  >
                    <span class="chat-speaker">
                      <Show when={!current()?.operatorView && message.role === 'assistant'}>
                        <Icon name="agent" />
                      </Show>
                      {current()?.operatorView
                        ? message.authorName || (message.role === 'user' ? 'You' : 'Requester')
                        : message.role === 'user'
                          ? 'You'
                          : 'Zuno'}
                    </span>
                    <Show when={message.attachments?.length}>
                      <div class="chat-attachments">
                        <For each={message.attachments}>
                          {(file) => (
                            <span class="chat-file-chip">
                              <Icon name="file" />
                              <span>{file.name}</span>
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={message.text}>
                      <Show
                        when={message.role === 'assistant'}
                        fallback={<div class="chat-message-text">{message.text}</div>}
                      >
                        <div onClick={openReferencedArticle}>
                          <ChatMarkdown text={message.text} />
                        </div>
                      </Show>
                    </Show>
                    <Show when={message.requestAction}>
                      <RequestChatAction
                        action={message.requestAction}
                        chatId={params.id}
                        messageId={message.id}
                        disabled={isReadOnly() || busy()}
                        onApplied={refreshChat}
                      />
                    </Show>
                    <Show when={message.formReceipt}>
                      {(receipt) => (
                        <section
                          class="chat-request-confirmation"
                          aria-label="Submitted request details"
                        >
                          <div>
                            <strong>{receipt().title}</strong>
                            <dl class="chat-receipt-answers">
                              <For each={receipt().answers || []}>
                                {(answer) => (
                                  <div>
                                    <dt>{answer.label}</dt>
                                    <dd>
                                      {typeof answer.value === 'boolean'
                                        ? answer.value
                                          ? 'Yes'
                                          : 'No'
                                        : answer.displayValue || answer.value || '—'}
                                    </dd>
                                  </div>
                                )}
                              </For>
                            </dl>
                            <A href={`/workspace/chat/${params.id}?request=${receipt().requestId}`}>
                              View {receipt().number}
                            </A>
                          </div>
                        </section>
                      )}
                    </Show>
                    <Show when={message.status === 'queued' || message.status === 'responding'}>
                      <Show when={!message.text}>
                        <span class="chat-typing-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </Show>
                    </Show>
                    <Show
                      when={
                        !current()?.operatorView &&
                        message.role === 'assistant' &&
                        message.kind !== 'request-confirmation'
                      }
                    >
                      <AgentProgress
                        phase={message.phase || message.status}
                        events={message.progress || []}
                      />
                    </Show>
                    <Show when={message.status === 'failed'}>
                      <p class="chat-response-error">{message.error || 'Response failed.'}</p>
                      <A href="/workspace/settings">AI settings</A>
                      <button
                        class="card-link"
                        type="button"
                        disabled={sending() || isReadOnly()}
                        onClick={retry}
                      >
                        Retry response
                      </button>
                    </Show>
                    <Show when={message.truncated}>
                      <small class="chat-response-status">Output limit reached</small>
                    </Show>
                  </article>
                )}
              </For>
              <Show when={pendingMessage()}>
                <article class="chat-message from-user">
                  <p>{pendingMessage()}</p>
                </article>
              </Show>
              <Show when={current()?.status === 'complete' && current()?.requestForm}>
                <RequestForm
                  form={current().requestForm}
                  identity={`${params.id}:${current().requestForm.offerId}`}
                  disabled={busy() || isReadOnly()}
                  onSubmit={async (answers) => {
                    const form = current().requestForm;
                    const ticket = await api(`${supportPath}/${params.id}/form`, {
                      method: 'POST',
                      body: JSON.stringify({
                        offerId: form.offerId,
                        workflowId: form.workflowId,
                        workflowVersion: form.workflowVersion,
                        answers,
                      }),
                    }).catch(async (error) => {
                      if (error.status === 409 || error.status === 403) {
                        await refreshChat();
                        throw new Error(
                          'The request form has been refreshed. Review it before submitting again.',
                        );
                      }
                      throw error;
                    });
                    setConversation({
                      ...conversation,
                      requestForm: null,
                      ticketId: ticket.id,
                      submittedForm: {
                        requestId: ticket.id,
                        number: ticket.number,
                        title: ticket.formSubmission?.title || ticket.title,
                      },
                    });
                    setSelectedRequest(ticket.id);
                    setQuery({ request: ticket.id });
                    await refreshChat();
                  }}
                />
              </Show>
            </div>
            <div class="chat-composer">
              <ChatPrompt
                autoFocus
                attachments={attachments()}
                uploading={uploading()}
                uploadStatus={uploadStatus()}
                onFiles={current()?.operatorView ? undefined : uploadFiles}
                placeholder={current()?.operatorView ? 'Reply to requester…' : 'Ask me anything'}
                onRemoveFile={(id) =>
                  setAttachments((items) => items.filter((file) => file.id !== id))
                }
                value={prompt()}
                onInput={setPrompt}
                disabled={busy() || isReadOnly()}
                readOnly={isReadOnly()}
                model={current()?.model}
                onSubmit={(event) => {
                  event.preventDefault();
                  submitMessage();
                }}
              />
            </div>
          </section>
          <Show when={hasSidePanel()}>
            <SplitResizeHandle storageKey="support-chat" />
            <aside
              class="chat-request-workspace"
              aria-label={articleId() ? 'Article reader' : 'Request workspace'}
            >
              <Show
                when={articleId()}
                fallback={
                  <>
                    <Show when={current()?.requests?.length > 1}>
                      <div class="chat-request-switcher">
                        <label>Requests</label>
                        <Dropdown
                          ariaLabel="Request"
                          value={activeRequest()?.id}
                          options={current().requests.map((item) => ({
                            value: item.id,
                            label: `${item.number} · ${item.title}`,
                          }))}
                          onChange={(value) => {
                            setSelectedRequest(value);
                            setQuery({ request: value });
                          }}
                        />
                      </div>
                    </Show>
                    <header class="chat-request-heading">
                      <div ref={setRequestLocationTarget} class="chat-request-location" />

                      <div ref={setRequestActionsTarget} class="chat-request-header-actions" />
                    </header>
                    <Show when={activeRequest()}>
                      {(item) => (
                        <RequestPanel
                          headerLocationTarget={requestLocationTarget()}
                          headerActionsTarget={requestActionsTarget()}
                          requestId={item().id}
                          refreshKey={item().version}
                          onChanged={refreshChat}
                        />
                      )}
                    </Show>
                  </>
                }
              >
                <header class="chat-request-heading">
                  <h2>Article</h2>
                  <button class="workspace-button secondary small" onClick={() => setArticleId('')}>
                    Close
                  </button>
                </header>
                <div class="chat-article-reader">
                  <Show when={readingArticle.loading}>
                    <Skeleton label="Loading article" lines={5} />
                  </Show>
                  <Show when={readingArticle.error}>
                    <ToastMessage tone="error">This article could not be loaded.</ToastMessage>
                  </Show>
                  <Show when={!readingArticle.error && readingArticle()}>
                    {(item) => (
                      <article>
                        <h1>{item().title}</h1>
                        <ArticleReader articleId={articleId()} body={item().body} />
                        <For each={item().sections || []}>
                          {(section) => (
                            <section>
                              <h2>{section.heading}</h2>
                              <p>{section.text}</p>
                            </section>
                          )}
                        </For>
                      </article>
                    )}
                  </Show>
                </div>
              </Show>
            </aside>
          </Show>
        </div>
      </Show>
      <Show when={error()}>
        <ToastMessage tone="error">{error()}</ToastMessage>
      </Show>
    </section>
  );
}
