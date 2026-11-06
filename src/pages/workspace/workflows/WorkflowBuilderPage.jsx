import WorkflowDangerZone from '../../../components/workflows/WorkflowDangerZone.jsx';
import { pollConversation } from '../../../services/chat/conversationPolling.js';
import ChatPanelToolbar from '../../../components/chat/ChatPanelToolbar.jsx';
import { hasWorkflowChanges } from '../../../services/workflows/workflowPublication.js';
import { followChatProgress } from '../../../services/chat/chatFollow.js';
import ConversationSkeleton from '../../../components/chat/ConversationSkeleton.jsx';
import SplitResizeHandle from '../../../components/SplitResizeHandle.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import ChatPrompt from '../../../components/chat/ChatPrompt.jsx';
import WorkflowVersions from '../../../components/workflows/WorkflowVersions.jsx';
import WorkflowVisual from '../../../components/workflows/WorkflowVisual.jsx';
import WorkflowApprovalEditor from '../../../components/workflows/WorkflowApprovalEditor.jsx';
import WorkflowSettingsEditor from '../../../components/workflows/WorkflowSettingsEditor.jsx';
import { confirmRemovedFields, clearConfirmedFields } from '../../../services/confirmations.js';
import Skeleton from '../../../components/Skeleton.jsx';
import CodeBlock from '../../../components/CodeBlock.jsx';
import { workflowChatText } from '../../../services/workflows/workflowChatText.js';
import WorkflowPermissionsEditor from '../../../components/workflows/WorkflowPermissionsEditor.jsx';
import WorkflowRoutingEditor from '../../../components/workflows/WorkflowRoutingEditor.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import { defineWorkflow, toTypeScript } from '../../../../api/sdk/workflows/index.js';
import RequestForm from '../../../components/requests/RequestForm.jsx';
import WorkflowFormEditor from '../../../components/workflows/WorkflowFormEditor.jsx';
import ChatMarkdown from '../../../components/chat/ChatMarkdown.jsx';
import { createStore, reconcile } from 'solid-js/store';
import ToastMessage from '../../../components/ToastMessage.jsx';
import { useNavigate, useParams, useSearchParams } from '@solidjs/router';
import A from '../../../components/WorkspaceLink.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import {
  For,
  Show,
  createEffect,
  batch,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import { api } from '../../../services/api.js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import Icon from '../../../components/Icon.jsx';
import AgentProgress from '../../../components/chat/AgentProgress.jsx';

export default function WorkflowBuilderPage() {
  const { access } = useWorkspace();
  const params = useParams();
  const [query, setQuery] = useSearchParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [loadedId, setLoadedId] = createSignal(null);
  const isAdmin = () => !access?.error && access?.()?.role === 'admin';
  const [saved, { refetch: refreshSaved }] = createResource(isAdmin, () =>
    api('/api/helpdesk/workflows'),
  );
  const [tab, setTab] = createSignal('visual');
  const [visualZoom, setVisualZoom] = createSignal(100);

  const [chatId, setChatId] = createSignal('');
  const [startingNewConversation, setStartingNewConversation] = createSignal(false);
  const [savedView] = createResource(
    () => isAdmin() && params.id,
    (id) => api(`/api/helpdesk/workflows/${id}/view`),
  );
  createEffect(() => {
    if (
      loadedId() !== params.id ||
      savedView.loading ||
      savedView.error ||
      savedView()?.workflowId !== params.id ||
      startingNewConversation() ||
      chatId() ||
      query.chat
    )
      return;
    if (savedView()?.chatId) setChatId(savedView().chatId);
  });
  createEffect(() => {
    const id = selected(),
      chat = chatId();
    if (id && chat)
      api(`/api/helpdesk/workflows/${id}/view`, {
        method: 'PUT',
        body: JSON.stringify({ chatId: chat }),
      }).catch((error) => setError(error.message));
  });
  const [conversation, { refetch }] = createResource(
    () => chatId() || false,
    (id) => api(`/api/helpdesk/workflow-conversations/${id}`),
  );
  const [activityMessages, setActivityMessages] = createStore({ messages: [] });
  createEffect(() => {
    setActivityMessages(
      'messages',
      reconcile(
        !conversation.error && chatId() && conversation()?.id === chatId()
          ? conversation()?.messages || []
          : [],
        {
          key: 'id',
        },
      ),
    );
  });
  const [selected, setSelected] = createSignal('');
  const [viewingHistory, setViewingHistory] = createSignal(false);
  const [historyRevision, setHistoryRevision] = createSignal(0);
  const refreshHistory = () => setHistoryRevision((value) => value + 1);
  const [baseDefinition, setBaseDefinition] = createSignal(null);
  const [text, setText] = createSignal('');
  const [pendingUserText, setPendingUserText] = createSignal('');
  let messageList;
  followChatProgress(
    () => messageList,
    () => JSON.stringify(conversation()?.messages || []),
    () => chatId(),
  );
  createEffect(() => {
    if (!pendingUserText()) return;
    requestAnimationFrame(() => {
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
  });
  const [source, setSource] = createSignal('');
  const [starterQueues] = createResource(
    () => tab() === 'typescript' && !selected() && isAdmin(),
    () => api('/api/helpdesk/queues'),
  );
  const [sourceEdited, setSourceEdited] = createSignal(false);
  const [codeDefinition, setCodeDefinition] = createSignal(null);
  const [editingCode, setEditingCode] = createSignal(false);
  const [testResult, setTestResult] = createSignal(null);
  const [testing, setTesting] = createSignal(false);
  const [runs, { refetch: refreshRuns }] = createResource(
    () => tab() === 'runs' && selected(),
    (id) => api(`/api/helpdesk/workflow-runs?workflowId=${id}`),
  );
  createEffect(() => {
    if (tab() !== 'runs' || !selected()) return;
    const timer = setInterval(() => refreshRuns().catch(() => {}), 3000);
    onCleanup(() => clearInterval(timer));
  });
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [savedDefinition, setSavedDefinition] = createSignal('');
  const [hasEdits, setHasEdits] = createSignal(false);
  const [saveStatus, setSaveStatus] = createSignal('');
  const [lastAttempt, setLastAttempt] = createSignal('');
  const current = () => !saved.error && saved()?.find((item) => item.id === selected());
  const [manualPermissions, setManualPermissions] = createSignal(undefined);
  const [manualName, setManualName] = createSignal(undefined);
  const [manualRouting, setManualRouting] = createSignal(undefined);
  const [manualForm, setManualForm] = createSignal(undefined);
  let latestAgentRevision = '';
  createEffect(() => {
    const chat = !conversation.error && conversation();
    if (
      !chatId() ||
      chat?.id !== chatId() ||
      chat.status !== 'complete' ||
      !chat.typescript ||
      !chat.definition
    )
      return;
    const response = chat.messages.filter((item) => item.role === 'assistant').at(-1);
    const revision = JSON.stringify([chat.id, response?.id, chat.typescript, chat.definition]);
    if (revision === latestAgentRevision) return;
    latestAgentRevision = revision;
    batch(() => {
      setSource(chat.typescript);
      setSourceEdited(false);
      setCodeDefinition(chat.definition);
      setManualForm(undefined);
      setManualRouting(undefined);
      setManualName(undefined);
      setManualPermissions(undefined);
    });
  });
  let latestDefinition = '';
  createEffect(() => {
    const value = JSON.stringify(
      (!conversation.error && conversation()?.definition) || baseDefinition(),
    );
    if (value !== latestDefinition) {
      latestDefinition = value;
      setManualForm(undefined);
      setManualRouting(undefined);
      setManualName(undefined);
      setManualPermissions(undefined);
    }
  });
  const definition = createMemo(() => {
    const value =
      codeDefinition() ||
      (chatId() && !conversation.error && conversation()?.definition) ||
      baseDefinition();
    if (!value) return value;
    const { form, ...rest } = value;
    return {
      ...rest,
      ...(manualPermissions() === undefined ? {} : { permissions: manualPermissions() }),
      ...(manualName() === undefined ? {} : { name: manualName() }),
      ...((manualForm() === undefined ? form : manualForm())
        ? { form: manualForm() === undefined ? form : manualForm() }
        : {}),
      ...(manualRouting() === undefined ? {} : { routing: manualRouting() }),
    };
  });
  const processing = () =>
    !!chatId() &&
    conversation()?.id === chatId() &&
    !conversation.error &&
    ['queued', 'responding'].includes(conversation()?.status);
  const code = () => {
    try {
      return source() || (definition() ? toTypeScript(definition()) : '');
    } catch {
      return '';
    }
  };
  pollConversation(() => processing(), refetch);
  createEffect(() => {
    if (!saved.loading && !saved.error && saved()) {
      const id = params.id || (/^[a-f0-9]{24}$/.test(query.draft || '') ? query.draft : '');
      if (loadedId() !== id) {
        setStartingNewConversation(false);
        if (id || loadedId() !== null) choose(id);
        if (/^[a-f0-9]{24}$/.test(query.chat || '')) setChatId(query.chat);
        setLoadedId(id);
      }
    }
  });
  createEffect(() => {
    const value = definition();
    const serialized = JSON.stringify({ definition: value, source: source() });
    if (
      !isAdmin() ||
      !hasEdits() ||
      viewingHistory() ||
      !value ||
      sending() ||
      saving() ||
      deleting() ||
      processing() ||
      serialized === savedDefinition() ||
      serialized === lastAttempt()
    )
      return;
    try {
      defineWorkflow(value);
    } catch {
      return;
    }
    const timer = setTimeout(() => save(false, true), 900);
    onCleanup(() => clearTimeout(timer));
  });
  async function send(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSending(true);
    const content = text().trim();
    setPendingUserText(content);
    setViewingHistory(false);
    setHasEdits(true);
    try {
      if (chatId())
        await api(`/api/helpdesk/workflow-conversations/${chatId()}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            text: content,
            ...(definition() ? { definition: definition() } : {}),
            ...(code() ? { source: code() } : {}),
          }),
        });
      else {
        const result = await api('/api/helpdesk/workflow-conversations', {
          method: 'POST',
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            ...(selected() ? { workflowId: selected() } : {}),
            text: content,
            ...(definition() ? { definition: definition() } : {}),
            ...(code() ? { source: code() } : {}),
          }),
        });
        batch(() => {
          setChatId(result.id);
          if (result.workflowId && !selected()) {
            setSelected(result.workflowId);
            setLoadedId(result.workflowId);
            setQuery({ chat: result.id, draft: result.workflowId }, { replace: true });
          } else setQuery({ chat: result.id }, { replace: true });
        });
        await refreshSaved();
      }
      setText('');
      await refetch();
      await refreshHistory();
    } catch (error) {
      setError(error.message);
    } finally {
      setPendingUserText('');
      setSending(false);
    }
  }
  function choose(id) {
    setHasEdits(false);
    setSourceEdited(false);
    setCodeDefinition(null);
    setManualForm(undefined);
    setSaveStatus('');
    setSelected(id);
    setChatId('');
    setText('');
    setError('');
    setMessage('');
    const item = !saved.error && saved()?.find((item) => item.id === id);
    setSource(item?.source || (item?.definition ? toTypeScript(item.definition) : ''));
    setSavedDefinition(
      item?.definition ? JSON.stringify({ definition: item.definition, source: item.source }) : '',
    );
    setBaseDefinition(
      item?.definition ||
        (item && !item.isAuthoringDraft
          ? {
              version: 1,
              name: item.name,
              trigger: { department: item.department, phrases: item.keywords },
              steps: [
                { id: 'route-request', action: item.action, params: { queueName: item.queueName } },
              ],
            }
          : null),
    );
  }
  async function save(enabled = false, automatic = false, unpublish = false) {
    setError('');
    setMessage('');
    if (saving() || deleting()) return;
    setSaving(true);
    setSaveStatus('Saving Draft…');
    const snapshot = JSON.stringify({ definition: definition(), source: source() });
    const savingRecordId = selected();
    setLastAttempt(snapshot);
    try {
      const value = definition();
      if (
        !(await confirmRemovedFields(
          current()?.definition?.form?.fields || [],
          value?.form?.fields || [],
        ))
      ) {
        setHasEdits(false);
        setSaveStatus('Removal Canceled');
        setCodeDefinition(current()?.definition || null);
        setSource(current()?.source || '');
        setManualForm(undefined);
        setManualPermissions(undefined);
        setManualName(undefined);
        setManualRouting(undefined);
        return;
      }
      const route = [...value.steps]
        .reverse()
        .find((step) => ['route', 'handoff'].includes(step.action));
      const result = await api(
        selected() ? `/api/helpdesk/workflows/${selected()}` : '/api/helpdesk/workflows',
        {
          method: selected() ? 'PUT' : 'POST',
          body: JSON.stringify({
            confirmedRemovedFieldIds: (current()?.definition?.form?.fields || [])
              .filter((field) => !(value.form?.fields || []).some((item) => item.id === field.id))
              .map((field) => field.id),
            name: value.name,
            department: value.trigger.department,
            keywords: value.trigger.phrases,
            action: route?.action || 'handoff',
            queueName: route?.params.queueName || value.trigger.department,
            enabled,
            ...(chatId() ? { conversationId: chatId() } : {}),
            intent: unpublish ? 'unpublish' : enabled ? 'publish' : 'draft',
            source: code(),
            ...(!sourceEdited() ? { definition: value } : {}),
            ...(selected() ? { version: current().version } : {}),
          }),
        },
      );
      clearConfirmedFields();
      await refreshSaved();
      if (selected() !== savingRecordId) return;
      const hasNewerEdits =
        snapshot !== JSON.stringify({ definition: definition(), source: source() });
      setSelected(result.id);
      if (!hasNewerEdits) {
        setSource(result.source);
        setSourceEdited(false);
        setCodeDefinition(result.definition);
        setManualName(undefined);
        setManualForm(undefined);
        setManualRouting(undefined);
        setManualPermissions(undefined);
      }
      setSavedDefinition(JSON.stringify({ definition: result.definition, source: result.source }));
      setSaveStatus(enabled ? 'Published' : unpublish ? 'Unpublished' : 'Draft Saved');
      if (!params.id) {
        setLoadedId(result.id);
        setQuery({ draft: result.id }, { replace: true });
      }
      if (!automatic)
        setMessage(
          enabled
            ? 'Workflow published.'
            : unpublish
              ? 'Workflow unpublished.'
              : 'Workflow draft saved.',
        );
    } catch (error) {
      setSaveStatus('Draft Not Saved');
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  const hasPublishedChanges = () =>
    current()?.enabled && hasWorkflowChanges(definition(), code(), current()?.publishedConfig);
  function publicationReason() {
    if (!definition()) return 'Create a workflow definition before publishing.';
    try {
      defineWorkflow(definition());
    } catch (error) {
      return error.message;
    }
    if (
      definition().steps.some(
        (step) =>
          ![
            'route',
            'handoff',
            'approval',
            'slack.postMessage',
            'task.create',
            'task.wait',
            'data.read',
            'data.create',
            'data.update',
            'data.delete',
          ].includes(step.action),
      )
    )
      return 'Choose a supported runtime action.';
    if (sending() || processing()) return 'Wait for the Admin agent to finish.';
    if (saving()) return 'Saving the draft…';
    return '';
  }
  async function testWorkflow(answers) {
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      const result = await api('/api/helpdesk/workflows/test', {
        method: 'POST',
        body: JSON.stringify({ source: code(), answers }),
      });
      setTestResult(result);
    } catch (error) {
      setError(error.message);
    } finally {
      setTesting(false);
    }
  }
  function tabsKey(event) {
    const values = [
      'visual',
      'form',
      'approvals',
      'settings',
      'typescript',
      'test',
      'runs',
      'history',
      'versions',
    ];
    const index = values.indexOf(tab());
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? values.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
      setTab(values[next]);
      document.getElementById(`workflow-tab-${values[next]}`)?.focus();
    }
  }
  return (
    <section class="workflow-page is-builder">
      <header class="workflow-builder-heading">
        <Breadcrumbs
          class="workflow-breadcrumbs"
          label="Workflow location"
          items={[{ label: 'Workflows', href: '/workspace/workflows' }]}
        >
          <h1>
            <Show
              when={definition()}
              fallback={params.id ? current()?.name || 'Edit Workflow' : 'New Workflow'}
            >
              <input
                class="workflow-name-input"
                aria-label="Workflow Name"
                maxlength="80"
                value={definition()?.name || ''}
                disabled={sending() || processing()}
                onInput={(event) => {
                  setViewingHistory(false);
                  setHasEdits(true);
                  setManualName(event.currentTarget.value);
                }}
              />
            </Show>
          </h1>
        </Breadcrumbs>
        <Show when={isAdmin()}>
          <div class="workflow-header-actions">
            <span class="workflow-save-status" role="status">
              <Show when={saving()}>
                <Icon name="loading" class="saving-spinner" />
              </Show>
              {saveStatus() || (definition() ? publicationReason() : '')}
            </span>
            <Show when={current()?.enabled}>
              <button
                class="workspace-button secondary small"
                disabled={saving() || sending() || processing()}
                onClick={() => save(false, false, true)}
              >
                Unpublish
              </button>
            </Show>
            <button
              class="workspace-button small"
              type="button"
              disabled={
                saving() ||
                sending() ||
                processing() ||
                !!publicationReason() ||
                (current()?.enabled && !hasPublishedChanges())
              }
              title={
                current()?.enabled && !hasPublishedChanges()
                  ? 'No unpublished changes'
                  : publicationReason() || 'Publish this workflow'
              }
              onClick={() => save(true)}
            >
              {current()?.enabled ? 'Publish Changes' : 'Publish'}
            </button>
          </div>
        </Show>
      </header>
      <Show
        when={isAdmin()}
        fallback={
          <Show
            when={!access.loading && !!access()}
            fallback={<Skeleton label="Checking administrator access" lines={3} />}
          >
            <ToastMessage tone="error">
              {access.error?.message || 'Administrator access is required.'}
            </ToastMessage>
          </Show>
        }
      >
        <Show when={error() || saved.error || conversation.error}>
          <ToastMessage tone="error">
            {error() || saved.error?.message || conversation.error?.message}
          </ToastMessage>
        </Show>
        <Show when={message()}>
          <ToastMessage tone="success" message={message()} />
        </Show>
        <div class="workflow-builder resizable-split">
          <SplitResizeHandle storageKey="builder" rightLabel="Workflow" />
          <section class="workflow-chat" aria-label="Workflow conversation">
            <ChatPanelToolbar
              disabled={processing()}
              onNewChat={async () => {
                setStartingNewConversation(true);
                setViewingHistory(false);
                setChatId('');
                setText('');
                setQuery({ chat: undefined });
                if (selected()) {
                  try {
                    await api(`/api/helpdesk/workflows/${selected()}/view`, {
                      method: 'PUT',
                      body: JSON.stringify({ chatId: null }),
                    });
                  } catch (error) {
                    setError(error.message);
                  }
                }
              }}
            />
            <div
              class="workflow-chat-history"
              ref={messageList}
              aria-live="polite"
              aria-relevant="additions text"
            >
              <Show when={chatId() && conversation.loading && conversation()?.id !== chatId()}>
                <ConversationSkeleton />
              </Show>
              <For each={activityMessages.messages}>
                {(item) => (
                  <Show when={item.role === 'assistant' || item.text || item.error}>
                    <article class={`workflow-chat-message ${item.role}`}>
                      <strong>{item.role === 'assistant' ? 'Admin agent' : 'You'}</strong>
                      <Show when={item.text}>
                        <Show when={item.role === 'assistant'} fallback={<p>{item.text}</p>}>
                          <ChatMarkdown text={workflowChatText(item.text)} />
                        </Show>
                      </Show>
                      <Show when={item.role === 'assistant'}>
                        <AgentProgress
                          toolCalls={item.toolCalls || []}
                          phase={item.phase || item.status || 'complete'}
                          events={item.progress || []}
                        />
                      </Show>
                      <Show when={item.error}>
                        <ToastMessage tone="error">{item.error}</ToastMessage>
                      </Show>
                    </article>
                  </Show>
                )}
              </For>
              <Show when={pendingUserText()}>
                <article class="workflow-chat-message user">
                  <strong>You</strong>
                  <p>{pendingUserText()}</p>
                </article>
              </Show>
              <Show
                when={
                  !conversation.error && !conversation.error && conversation()?.status === 'failed'
                }
              >
                <button
                  class="workspace-button secondary small"
                  onClick={async () => {
                    try {
                      await api(`/api/helpdesk/workflow-conversations/${chatId()}/messages`, {
                        method: 'POST',
                        body: JSON.stringify({ retry: true }),
                      });
                      await refetch();
                    } catch (error) {
                      setError(error.message);
                    }
                  }}
                >
                  Retry response
                </button>
              </Show>
            </div>
            <div class="builder-chat-composer">
              <ChatPrompt
                value={text()}
                onInput={setText}
                onSubmit={send}
                placeholder="Describe a workflow or ask the Admin agent to change it…"
                disabled={
                  sending() ||
                  processing() ||
                  (!conversation.error && conversation()?.status === 'failed')
                }
              />
            </div>
          </section>
          <section class="workflow-design" aria-label="Workflow design">
            <div
              class="workflow-tabs"
              role="tablist"
              aria-label="Workflow view"
              onKeyDown={tabsKey}
            >
              <For
                each={[
                  'visual',
                  'form',
                  'approvals',
                  'settings',
                  'typescript',
                  'test',
                  'runs',
                  'history',
                  'versions',
                ]}
              >
                {(value) => (
                  <button
                    id={`workflow-tab-${value}`}
                    role="tab"
                    aria-controls="workflow-panel"
                    aria-selected={tab() === value}
                    tabindex={tab() === value ? 0 : -1}
                    onClick={() => setTab(value)}
                  >
                    {value === 'visual'
                      ? 'Visual'
                      : value === 'form'
                        ? 'Form'
                        : value === 'approvals'
                          ? 'Approvals'
                          : value === 'settings'
                            ? 'Settings'
                            : value === 'typescript'
                              ? 'Code'
                              : value === 'test'
                                ? 'Test'
                                : value === 'runs'
                                  ? 'Runs'
                                  : value === 'versions'
                                    ? 'Versions'
                                    : value === 'history'
                                      ? 'History'
                                      : 'SDK'}
                  </button>
                )}
              </For>
            </div>
            <div
              id="workflow-panel"
              role="tabpanel"
              aria-labelledby={`workflow-tab-${tab()}`}
              tabindex="0"
              class="workflow-panel"
            >
              <Show when={tab() === 'visual'}>
                <WorkflowVisual
                  definition={definition()}
                  workflow={current()}
                  canManage={isAdmin()}
                  disabled={saving() || sending() || processing()}
                  onChange={(value) => {
                    setCodeDefinition(value);
                    setSourceEdited(false);
                    setHasEdits(true);
                  }}
                  zoom={visualZoom()}
                  onZoomChange={setVisualZoom}
                />
                <Show when={!conversation.error && conversation()?.validationError}>
                  <ToastMessage tone="error" message={conversation().validationError} />
                </Show>
              </Show>
              <Show when={tab() === 'form'}>
                <Show
                  when={definition()}
                  fallback={
                    <div class="workflow-empty">
                      <p>Describe an order item in chat, or start a form manually.</p>
                      <button
                        class="workspace-button secondary small"
                        type="button"
                        onClick={() => (
                          setHasEdits(true),
                          setBaseDefinition({
                            version: 1,
                            name: 'New Request',
                            trigger: { phrases: [] },
                            steps: [
                              {
                                id: 'route-request',
                                action: 'route',
                                params: { queueName: 'general' },
                              },
                            ],
                          })
                        )}
                      >
                        Create Form
                      </button>
                    </div>
                  }
                >
                  <WorkflowFormEditor
                    form={definition()?.form}
                    name={definition()?.name}
                    disabled={sending() || processing()}
                    onChange={(form) => {
                      setViewingHistory(false);
                      setHasEdits(true);
                      setManualForm(form);
                    }}
                  />
                  <WorkflowRoutingEditor
                    includeDemo={Boolean(current()?.demoDatasetId)}
                    form={definition()?.form}
                    rules={definition()?.routing}
                    disabled={sending() || processing()}
                    onChange={(routing) => {
                      setViewingHistory(false);
                      setHasEdits(true);
                      setManualRouting(routing);
                      setSource(toTypeScript({ ...definition(), routing }));
                    }}
                  />
                </Show>
              </Show>
              <Show when={tab() === 'approvals'}>
                <Show when={definition()}>
                  <WorkflowApprovalEditor
                    includeDemo={Boolean(current()?.demoDatasetId)}
                    value={definition()}
                    disabled={sending() || processing()}
                    onChange={(value) => {
                      setCodeDefinition(value);
                      setSourceEdited(false);
                      setHasEdits(true);
                    }}
                  />
                </Show>
              </Show>
              <Show when={tab() === 'settings'}>
                <Show
                  when={definition()}
                  fallback={<p>Create a workflow before configuring its permissions.</p>}
                >
                  <WorkflowSettingsEditor
                    includeDemo={Boolean(current()?.demoDatasetId)}
                    value={definition()}
                    disabled={sending() || processing()}
                    onChange={(value) => {
                      setCodeDefinition(value);
                      setSourceEdited(false);
                      setHasEdits(true);
                    }}
                  />
                  <WorkflowPermissionsEditor
                    includeDemo={Boolean(current()?.demoDatasetId)}
                    value={definition()?.permissions}
                    disabled={sending() || processing()}
                    onChange={(permissions) => {
                      setViewingHistory(false);
                      setHasEdits(true);
                      setManualPermissions(permissions);
                    }}
                  />
                </Show>
              </Show>
              <Show when={tab() === 'settings' && current()} keyed>
                {(workflow) => (
                  <WorkflowDangerZone
                    workflow={workflow}
                    destination={path('/workspace/workflows')}
                    disabled={saving() || sending() || processing()}
                    onBusy={setDeleting}
                    onDeleted={() => {
                      setHasEdits(false);
                      window.dispatchEvent(new Event('agentzuno-form-saved'));
                      navigate(path('/workspace/workflows'));
                    }}
                  />
                )}
              </Show>
              <Show when={tab() === 'typescript'}>
                <Show
                  when={code()}
                  fallback={
                    <Show
                      when={saved.loading && params.id}
                      fallback={
                        <div class="workflow-empty">
                          <p>Describe a workflow in chat, or start with editable TypeScript.</p>
                          <Show
                            when={!starterQueues.error && starterQueues()?.length}
                            fallback={
                              <A
                                class="workspace-button secondary"
                                href="/workspace/users?tab=groups"
                              >
                                Create an Assignment Group
                              </A>
                            }
                          >
                            <button
                              class="workspace-button"
                              onClick={() => {
                                const value = {
                                  version: 1,
                                  name: 'New Workflow',
                                  trigger: { phrases: [] },
                                  steps: [
                                    {
                                      id: 'assign-support',
                                      action: 'route',
                                      params: { queueName: starterQueues()[0].name },
                                    },
                                  ],
                                };
                                setBaseDefinition(value);
                                setSource(toTypeScript(value));
                                setCodeDefinition(value);
                                setSourceEdited(false);
                                setHasEdits(true);
                                setEditingCode(true);
                              }}
                            >
                              Start with Code
                            </button>
                          </Show>
                        </div>
                      }
                    >
                      <Skeleton label="Loading TypeScript" lines={16} />
                    </Show>
                  }
                >
                  <div class="workflow-code-actions">
                    <button
                      class="workspace-button secondary small"
                      onClick={() => navigator.clipboard.writeText(code())}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      class="workspace-button secondary small"
                      onClick={() => setEditingCode(!editingCode())}
                    >
                      {editingCode() ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  <Show
                    when={editingCode()}
                    fallback={<CodeBlock code={code()} language="typescript" />}
                  >
                    <textarea
                      class="workflow-code-editor"
                      aria-label="Executable TypeScript"
                      spellcheck={false}
                      value={code()}
                      onInput={(event) => {
                        setSource(event.currentTarget.value);
                        setSourceEdited(true);
                        setHasEdits(true);
                        setViewingHistory(false);
                      }}
                    />
                  </Show>
                </Show>
              </Show>
              <Show when={tab() === 'test'}>
                <h2>Test Workflow</h2>
                <p>
                  Preview the executed steps with sample answers. No live actions are performed.
                </p>
                <Show
                  when={definition()?.form}
                  fallback={
                    <button
                      class="workspace-button"
                      disabled={testing() || !code()}
                      onClick={() => testWorkflow({})}
                    >
                      Run Test
                    </button>
                  }
                >
                  <RequestForm
                    form={definition()?.form}
                    identity={`test:${selected()}:${JSON.stringify(definition()?.form)}`}
                    disabled={testing()}
                    onSubmit={testWorkflow}
                    submitLabel="Run Test"
                  />
                </Show>
                <Show when={testResult()}>
                  <p>{testResult().message}</p>
                  <For each={testResult().steps}>
                    {(step) => (
                      <div class="workflow-node">
                        <strong>{step.action}</strong>
                        <CodeBlock code={JSON.stringify(step.input, null, 2)} language="json" />
                        <small>{step.status}</small>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
              <Show when={tab() === 'runs'}>
                <h2>Workflow Runs</h2>
                <Show
                  when={!runs.error && runs()?.length}
                  fallback={
                    <p>
                      {runs.loading
                        ? 'Loading runs…'
                        : 'No runs yet. Published workflows run after an employee submits a request.'}
                    </p>
                  }
                >
                  <For each={runs() || []}>
                    {(run) => (
                      <section class="workflow-run">
                        <A href={`/workspace/requests/${run.requestId}`}>View Request</A>
                        <p>
                          Revision {run.revision} · {run.status.replaceAll('-', ' ')}
                        </p>
                        <For each={run.steps}>
                          {(step) => (
                            <div>
                              <strong>{step.action}</strong> · {step.status.replaceAll('-', ' ')}
                              <Show
                                when={
                                  step.status === 'awaiting-record-confirmation' &&
                                  step.result?.href
                                }
                              >
                                <A class="workspace-button secondary small" href={step.result.href}>
                                  Review Record Deletion
                                </A>
                              </Show>
                              <Show when={step.status === 'awaiting-approval'}>
                                <p>{step.input.reason}</p>
                                <For each={[true, false]}>
                                  {(approved) => (
                                    <button
                                      class="workspace-button secondary small"
                                      onClick={async () => {
                                        try {
                                          await api(
                                            `/api/helpdesk/workflow-runs/${run.id}/decisions`,
                                            {
                                              method: 'POST',
                                              body: JSON.stringify({ stepId: step.id, approved }),
                                            },
                                          );
                                          await refreshRuns();
                                        } catch (error) {
                                          setError(error.message);
                                        }
                                      }}
                                    >
                                      {approved ? 'Approve' : 'Decline'}
                                    </button>
                                  )}
                                </For>
                              </Show>
                            </div>
                          )}
                        </For>
                        <Show when={run.error}>
                          <p>{run.error}</p>
                        </Show>
                      </section>
                    )}
                  </For>
                </Show>
              </Show>
              <Show when={tab() === 'versions'}>
                <Show
                  when={current()}
                  fallback={<p>Save a workflow draft to start its version history.</p>}
                >
                  {(workflow) => (
                    <WorkflowVersions
                      workflow={workflow()}
                      busy={saving() || processing()}
                      onRestored={async () => {
                        const id = selected();
                        setHasEdits(false);
                        setManualName(undefined);
                        setManualRouting(undefined);
                        setManualPermissions(undefined);
                        setViewingHistory(false);
                        await refreshSaved();
                        choose(id);
                        setSaveStatus('Restored Draft');
                      }}
                    />
                  )}
                </Show>
              </Show>
              <Show when={tab() === 'history'}>
                <RecordTable
                  label="Workflow Conversations"
                  source="/api/helpdesk/workflow-conversations"
                  sourceParams={{ workflowId: selected() || undefined }}
                  refreshKey={historyRevision()}
                  defaultSort={{ key: 'Updated', direction: 'desc' }}
                  onRowClick={(item) => {
                    setViewingHistory(true);
                    setChatId(item.id);
                    setManualForm(undefined);
                    setManualRouting(undefined);
                    setManualName(undefined);
                    setManualPermissions(undefined);
                    setQuery({ chat: item.id }, { replace: true });
                  }}
                  columns={[
                    {
                      label: 'Conversation',
                      sortValue: (item) => item.title,
                      render: (item) => (
                        <button
                          class="record-table-link"
                          onClick={() => {
                            setViewingHistory(true);
                            setChatId(item.id);
                            setManualForm(undefined);
                            setManualRouting(undefined);
                            setManualName(undefined);
                            setManualPermissions(undefined);
                            setQuery({ chat: item.id }, { replace: true });
                          }}
                        >
                          {item.title}
                        </button>
                      ),
                    },
                    { key: 'status', label: 'Status' },
                    {
                      label: 'Updated',
                      sortValue: (item) => Date.parse(item.updatedAt),
                      defaultDirection: 'desc',
                      render: (item) => new Date(item.updatedAt).toLocaleString(),
                    },
                  ]}
                  emptyText="No conversations saved yet"
                />
              </Show>
            </div>
          </section>
        </div>
      </Show>
    </section>
  );
}
