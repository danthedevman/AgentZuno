import Icon from '../Icon.jsx';
import ChatPanelToolbar from '../chat/ChatPanelToolbar.jsx';
import { followChatProgress } from '../../services/chat/chatFollow.js';
import ConversationSkeleton from '../chat/ConversationSkeleton.jsx';
import SplitResizeHandle from '../SplitResizeHandle.jsx';
import Breadcrumbs from '../Breadcrumbs.jsx';
import ChatPrompt from '../chat/ChatPrompt.jsx';
import { workflowChatText } from '../../services/workflows/workflowChatText.js';
import CodeBlock from '../CodeBlock.jsx';
import { For, Show, createSignal, createEffect } from 'solid-js';
import A from '../WorkspaceLink.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import DataDefinitionEditor from './DataDefinitionEditor.jsx';
import RecordField from '../records/RecordField.jsx';
import ChatMarkdown from '../chat/ChatMarkdown.jsx';
import AgentProgress from '../chat/AgentProgress.jsx';
import ToastMessage from '../ToastMessage.jsx';
export default function DataTableBuilder(props) {
  const [tab, setTab] = createSignal('fields');
  let messageList;
  followChatProgress(
    () => messageList,
    () => JSON.stringify(props.messages || []),
  );
  createEffect(() => {
    if (!props.scrollRevision) return;
    requestAnimationFrame(() => {
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
  });
  const tabs = ['fields', 'settings', 'preview', 'definition'];
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const position = tabs.indexOf(tab());
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (position + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next]);
    document.getElementById(`data-tab-${tabs[next]}`)?.focus();
  }
  return (
    <>
      <header class="workflow-builder-heading">
        <Breadcrumbs
          class="workflow-breadcrumbs"
          label="Data table location"
          items={[
            { label: 'Data Tables', href: '/workspace/data' },
            !props.isNew && {
              label: props.value.name || 'Table',
              href: `/workspace/data/${props.tableId}`,
            },
            { content: <h1>{props.isNew ? props.value.name || 'New Table' : 'Edit Fields'}</h1> },
          ]}
        />
        <div class="workflow-header-actions">
          <A
            class="workspace-button secondary small"
            href={props.isNew ? '/workspace/data' : `/workspace/data/${props.tableId}`}
          >
            Cancel
          </A>
          <button
            class="workspace-button small"
            type="submit"
            form="data-table-definition"
            disabled={props.saving || props.processing}
            onClick={() => setTab('fields')}
          >
            <Icon name="save" />

            {props.saving ? 'Saving…' : 'Save Table'}
          </button>
        </div>
      </header>
      <div class="workflow-builder resizable-split">
        <SplitResizeHandle storageKey="builder" rightLabel="Table" />
        <section class="workflow-chat" aria-label="Table design conversation">
          <ChatPanelToolbar
            disabled={props.processing || props.sending}
            onNewChat={props.onNewConversation}
          />
          <div
            class="workflow-chat-history"
            ref={messageList}
            aria-live="polite"
            aria-relevant="additions text"
          >
            <Show when={props.error}>
              <ToastMessage tone="error">{props.error}</ToastMessage>
            </Show>
            <Show when={props.loading}>
              <ConversationSkeleton />
            </Show>
            <For each={props.loading ? [] : props.messages}>
              {(message) => (
                <article class={`workflow-chat-message ${message.role}`}>
                  <strong>{message.role === 'user' ? 'You' : 'Admin Agent'}</strong>
                  <Show when={message.role === 'assistant'} fallback={<p>{message.text}</p>}>
                    <ChatMarkdown text={workflowChatText(message.text)} />
                    <AgentProgress
                      toolCalls={message.toolCalls || []}
                      phase={message.phase || message.status}
                      events={message.progress || []}
                    />
                  </Show>
                  <Show when={message.error}>
                    <p>{message.error}</p>
                  </Show>
                </article>
              )}
            </For>
          </div>
          <div class="builder-chat-composer">
            <ChatPrompt
              value={props.prompt}
              onInput={props.onPrompt}
              onSubmit={props.onSend}
              placeholder="Describe fields to add or changes to this table…"
              disabled={props.sending || props.processing || props.failed}
            />
          </div>
        </section>
        <section class="workflow-design" aria-label="Table design">
          <div class="workflow-tabs" role="tablist" aria-label="Table view" onKeyDown={tabKey}>
            <For each={tabs}>
              {(value) => (
                <button
                  type="button"
                  role="tab"
                  id={`data-tab-${value}`}
                  aria-selected={tab() === value}
                  aria-controls="data-design-panel"
                  tabindex={tab() === value ? 0 : -1}
                  onClick={() => setTab(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              )}
            </For>
          </div>
          <div
            class="workflow-panel"
            id="data-design-panel"
            role="tabpanel"
            aria-labelledby={`data-tab-${tab()}`}
          >
            <div hidden={tab() !== 'fields'}>
              <ValidatedForm id="data-table-definition" class="create-form" onSubmit={props.onSave}>
                <DataDefinitionEditor
                  fieldsOnly
                  value={props.value}
                  onChange={props.onChange}
                  tables={props.tables}
                  protectedFields={props.protectedFields}
                />
              </ValidatedForm>
            </div>
            <div hidden={tab() !== 'settings'}>
              <ValidatedForm class="create-form" onSubmit={props.onSave}>
                <DataDefinitionEditor settingsOnly value={props.value} onChange={props.onChange} />
              </ValidatedForm>
            </div>
            <Show when={tab() === 'preview'}>
              <h2>{props.value.name || 'Record Preview'}</h2>
              <fieldset class="data-record-preview create-form" disabled>
                <For each={props.value.fields}>
                  {(field) => (
                    <RecordField
                      field={field}
                      value={field.type === 'boolean' ? false : ''}
                      onChange={() => {}}
                    />
                  )}
                </For>
              </fieldset>
            </Show>
            <Show when={tab() === 'definition'}>
              <CodeBlock code={JSON.stringify(props.value, null, 2)} language="json" />
            </Show>
          </div>
        </section>
      </div>
    </>
  );
}
