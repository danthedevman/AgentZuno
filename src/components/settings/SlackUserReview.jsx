import Icon from '../Icon.jsx';
import { For, Show, createResource, createSignal } from 'solid-js';
import { api } from '../../services/api.js';
import { confirmAction } from '../../services/confirmations.js';
import { useToasts } from '../../context/ToastContext.jsx';
import ReferenceLookup from '../ReferenceLookup.jsx';
import Skeleton from '../Skeleton.jsx';
export default function SlackUserReview(props) {
  const [review, setReview] = createSignal(null),
    [page, setPage] = createSignal(1),
    [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal({}),
    [busy, setBusy] = createSignal(false);
  const { notify } = useToasts();
  const [results] = createResource(
    () => (review() ? { id: review().id, page: page(), search: search() } : false),
    ({ id, page, search }) =>
      api(
        `/api/helpdesk/channels/slack/users/reviews/${id}?page=${page}&search=${encodeURIComponent(search)}`,
      ),
  );
  async function discover() {
    setBusy(true);
    try {
      const result = await api('/api/helpdesk/channels/slack/users/discover', {
        method: 'POST',
        body: '{}',
      });
      setSelected({});
      setPage(1);
      setSearch('');
      setReview(result);
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  async function selectAll() {
    setBusy(true);
    try {
      const result = await api(
        `/api/helpdesk/channels/slack/users/reviews/${review().id}?selection=suggested&search=${encodeURIComponent(search())}`,
      );
      setSelected(
        Object.fromEntries(result.bindings.map((item) => [item.slackUserId, item.userId])),
      );
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    const bindings = Object.entries(selected())
      .filter(([, value]) => value)
      .map(([slackUserId, userId]) => ({ slackUserId, userId }));
    if (
      !bindings.length ||
      !(await confirmAction(
        `Link ${bindings.length} selected Slack members to the reviewed workspace users? Roles and permissions will stay the same.`,
        'Confirm User Links',
        'Link Selected Users',
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/helpdesk/channels/slack/users/apply', {
        method: 'POST',
        body: JSON.stringify({
          id: review().id,
          version: review().version,
          bindings,
          confirmed: true,
        }),
      });
      setReview(null);
      setSelected({});
      await props.onSaved();
      notify({ tone: 'success', message: 'Slack users linked.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="slack-user-review">
      <h2>Link Workspace Users</h2>
      <p>
        Find Slack members and review suggested email matches. No accounts are created and no
        permissions change. Guests, bots, invited and deactivated members are excluded.
      </p>
      <div class="helpdesk-actions">
        <button
          type="button"
          class="workspace-button secondary small"
          disabled={busy() || props.disabled}
          onClick={discover}
        >
          {busy() ? 'Working…' : 'Find Slack Users'}
        </button>
      </div>
      <Show when={props.disabled}>
        <p>Save your bot settings before finding users.</p>
      </Show>
      <Show when={review()}>
        <div class="helpdesk-actions">
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={busy()}
            onClick={selectAll}
          >
            Select All Suggested Matches
          </button>
          <button
            type="button"
            class="workspace-button secondary small"
            onClick={() => setSelected({})}
          >
            Clear Selection
          </button>
          <span>{Object.values(selected()).filter(Boolean).length} selected across pages</span>
        </div>
        <label>
          Search Slack users
          <input
            type="search"
            placeholder="Search Slack users"
            value={search()}
            onInput={(event) => {
              setPage(1);
              setSearch(event.currentTarget.value);
            }}
          />
        </label>
        <Show when={!results.loading} fallback={<Skeleton />}>
          <Show when={!results.error} fallback={<p role="alert">{results.error?.message}</p>}>
            <Show when={results()?.rows.length} fallback={<p>No eligible Slack members found.</p>}>
              <For each={results()?.rows || []}>
                {(row) => (
                  <div class="slack-user-review-row">
                    <label class="slack-user-review-person">
                      <input
                        type="checkbox"
                        disabled={row.status === 'Linked'}
                        checked={!!selected()[row.slackUserId]}
                        onChange={(event) =>
                          setSelected((items) => ({
                            ...items,
                            [row.slackUserId]: event.currentTarget.checked ? row.userId : '',
                          }))
                        }
                      />
                      <span>
                        <strong>{row.name}</strong>
                        <small>
                          {row.email || row.slackUserId} · {row.status}
                        </small>
                      </span>
                    </label>
                    <ReferenceLookup
                      label="Workspace User"
                      value={selected()[row.slackUserId] || row.userId}
                      options={(props.users || []).map((user) => ({
                        value: user.id,
                        label: user.name,
                      }))}
                      disabled={row.status === 'Linked'}
                      onChange={(userId) =>
                        setSelected((items) => ({ ...items, [row.slackUserId]: userId }))
                      }
                    />
                  </div>
                )}
              </For>
              <div class="helpdesk-actions">
                <button
                  type="button"
                  class="workspace-button secondary small"
                  disabled={page() === 1}
                  onClick={() => setPage(page() - 1)}
                >
                  Previous
                </button>
                <span>
                  Page {page()} of {Math.max(1, Math.ceil((results()?.total || 0) / 20))} ·{' '}
                  {results()?.total || 0} members
                </span>
                <button
                  type="button"
                  class="workspace-button secondary small"
                  disabled={page() * 20 >= (results()?.total || 0)}
                  onClick={() => setPage(page() + 1)}
                >
                  Next
                </button>
              </div>
            </Show>
          </Show>
        </Show>
        <button
          type="button"
          class="workspace-button small"
          disabled={busy() || !Object.values(selected()).some(Boolean)}
          onClick={apply}
        >
          <Icon name="link" />
          Link Selected Users
        </button>
      </Show>
    </section>
  );
}
