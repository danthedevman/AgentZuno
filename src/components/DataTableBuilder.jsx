import ChatSendButton from './ChatSendButton.jsx';
import { workflowChatText } from '../services/workflowChatText.js';
import CodeBlock from './CodeBlock.jsx';
import { For, Show, createSignal, createEffect } from 'solid-js';
import A from './WorkspaceLink.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import DataDefinitionEditor from './DataDefinitionEditor.jsx';
import DataRecordField from './DataRecordField.jsx';
import ChatMarkdown from './ChatMarkdown.jsx';
import AgentProgress from './AgentProgress.jsx';
import ToastMessage from './ToastMessage.jsx';
export default function DataTableBuilder(props) {
  const [tab, setTab] = createSignal('fields');
  let messageList;
  createEffect(() => {
    if (!props.scrollRevision) return;
    requestAnimationFrame(() => {
      if (messageList) messageList.scrollTop = messageList.scrollHeight;
    });
  });
  const tabs = ['fields', 'preview', 'definition'];
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
        <nav class="breadcrumbs workflow-breadcrumbs" aria-label="Data table location">
          <ol>
            <li>
              <A href="/workspace/data">Data</A>
            </li>
            <li>
              <h1 aria-current="page">{props.value.name || 'New Table'}</h1>
            </li>
          </ol>
        </nav>
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
            {props.saving ? 'Saving…' : 'Save Table'}
          </button>
        </div>
      </header>
      <div class="workflow-builder">
        <section class="workflow-chat" aria-label="Table design conversation">
          <div
            class="workflow-chat-history"
            ref={messageList}
            aria-live="polite"
            aria-relevant="additions text"
          >
            <Show when={!props.messages.length}>
              <h2>What should your table capture?</h2>
            </Show>
            <Show when={props.error}>
              <ToastMessage tone="error">{props.error}</ToastMessage>
            </Show>
            <For each={props.messages}>
              {(message) => (
                <article class={`workflow-chat-message ${message.role}`}>
                  <strong>{message.role === 'user' ? 'You' : 'Admin Agent'}</strong>
                  <Show when={message.role === 'assistant'} fallback={<p>{message.text}</p>}>
                    <ChatMarkdown text={workflowChatText(message.text)} />
                    <AgentProgress
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
          <form class="workflow-composer" novalidate onSubmit={props.onSend}>
            <label class="sr-only" for="data-prompt">
              Describe your table
            </label>
            <div class="composer-input-surface">
              <textarea
                id="data-prompt"
                maxlength="4000"
                rows="4"
                value={props.prompt}
                onInput={(event) => props.onPrompt(event.currentTarget.value)}
                placeholder="Describe fields to add or changes to this table…"
              />
              <ChatSendButton
                disabled={props.sending || props.processing || props.failed || !props.prompt.trim()}
              />
            </div>
          </form>
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
                  value={props.value}
                  onChange={props.onChange}
                  tables={props.tables}
                  protectedFields={props.protectedFields}
                />
              </ValidatedForm>
            </div>
            <Show when={tab() === 'preview'}>
              <h2>{props.value.name || 'Record Preview'}</h2>
              <fieldset class="data-record-preview create-form" disabled>
                <For each={props.value.fields}>
                  {(field) => (
                    <DataRecordField
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
