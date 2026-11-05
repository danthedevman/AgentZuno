import { For, Show, createResource, createSignal } from 'solid-js';
import { api } from '../services/api.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { useSession } from '../context/SessionContext.jsx';
import { useToasts } from '../context/ToastContext.jsx';
import ProfileAvatar from './ProfileAvatar.jsx';
import Skeleton from './Skeleton.jsx';
import ToastMessage from './ToastMessage.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import MentionTextarea from './MentionTextarea.jsx';
import { useSearchParams } from '@solidjs/router';
import ListPagination from './ListPagination.jsx';

export default function RecordActivity(props) {
  const { preferences, savePreferences } = useSession();
  const { access } = useWorkspace();
  const { notify } = useToasts();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = createSignal(searchParams.activity === 'notes' ? 'notes' : 'comments');
  const [mentionIds, setMentionIds] = createSignal([]);
  const [page, setPage] = createSignal(1);
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const pageSize = () => (preferences.error ? 20 : preferences()?.listPageSize || 20);
  const endpoint = () => `/api/helpdesk/record-activity/${props.kind}/${props.recordId}`;
  const [activity, { refetch }] = createResource(
    () => ({
      url: endpoint(),
      tableId: props.tableId || '',
      type: tab(),
      page: page(),
      pageSize: pageSize(),
    }),
    ({ url, ...query }) => api(`${url}?${new URLSearchParams(query)}`),
  );
  const permissions = () => (activity.error ? {} : activity.latest?.permissions || {});
  const canPost = () => (tab() === 'notes' ? permissions().canNote : permissions().canComment);
  async function submit(event) {
    event.preventDefault();
    if (busy() || !canPost()) return;
    setBusy(true);
    try {
      await api(endpoint(), {
        method: 'POST',
        body: JSON.stringify({
          type: tab() === 'notes' ? 'note' : 'comment',
          text: text(),
          mentionIds: mentionIds(),
          ...(props.tableId ? { tableId: props.tableId } : {}),
        }),
      });
      setText('');
      setPage(1);
      await refetch();
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="record-activity" aria-label="Record conversation">
      <div class="record-activity-tabs" role="tablist" aria-label="Record activity">
        <For
          each={
            (permissions().canReadNotes ?? ['admin', 'agent', 'read-only'].includes(access()?.role))
              ? ['comments', 'notes']
              : ['comments']
          }
        >
          {(item) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab() === item}
              aria-controls="record-activity-content"
              id={`record-activity-${item}`}
              disabled={busy()}
              onClick={() => {
                setTab(item);
                setPage(1);
                setText('');
              }}
            >
              {item === 'comments' ? 'Comments' : 'Work Notes'}
            </button>
          )}
        </For>
      </div>
      <div
        id="record-activity-content"
        role="tabpanel"
        aria-labelledby={`record-activity-${tab()}`}
        aria-busy={activity.loading}
      >
        <Show when={canPost()}>
          <ValidatedForm class="create-form record-activity-composer" onSubmit={submit}>
            <label>
              {tab() === 'notes' ? 'Work Note' : 'Comment'}
              <MentionTextarea
                name="text"
                required
                maxlength="7000"
                rows="3"
                value={text()}
                mentionEndpoint={`${endpoint()}/mention-options`}
                tableId={props.tableId}
                kind={tab() === 'notes' ? 'work-note' : 'comment'}
                onInput={setText}
                onMentionsChange={setMentionIds}
              />
            </label>
            <button class="workspace-button small" disabled={busy()}>
              {busy() ? 'Posting…' : tab() === 'notes' ? 'Add Note' : 'Add Comment'}
            </button>
          </ValidatedForm>
        </Show>
        <Show when={activity.error}>
          <ToastMessage tone="error">{activity.error.message}</ToastMessage>
        </Show>
        <Show
          when={!activity.loading && !activity.error}
          fallback={
            <Show when={!activity.error}>
              <Skeleton label="Loading activity" lines={4} />
            </Show>
          }
        >
          <div class="record-activity-feed">
            <For
              each={activity()?.rows || []}
              fallback={
                <p class="record-activity-empty">
                  {tab() === 'notes' ? 'No work notes yet' : 'No comments yet'}
                </p>
              }
            >
              {(item) => (
                <article class="record-activity-entry">
                  <ProfileAvatar userId={item.authorId} name={item.authorName} />
                  <div>
                    <header>
                      <strong>{item.authorName}</strong>
                      <time datetime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString()}
                      </time>
                    </header>
                    <Show when={item.type === 'note'}>
                      <span class="record-note-label">Work Note</span>
                    </Show>
                    <p>{item.text}</p>
                  </div>
                </article>
              )}
            </For>
          </div>
          <Show when={activity()?.total > 0}>
            <ListPagination
              page={activity().page}
              pageSize={activity().pageSize}
              total={activity().total}
              loading={busy()}
              onPage={setPage}
              onPageSize={async (size) => {
                await savePreferences({ listPageSize: size });
                setPage(1);
              }}
            />
          </Show>
        </Show>
      </div>
    </section>
  );
}
