import Dropdown from './Dropdown.jsx';
import { timeZoneOptions } from '../services/timezones.js';
import ReferenceArrow from './ReferenceArrow.jsx';
import { useSession } from '../context/SessionContext.jsx';
import ProfileAvatar from './ProfileAvatar.jsx';
import Skeleton from './Skeleton.jsx';
import Icon from './Icon.jsx';
import PageHeading from './PageHeading.jsx';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { api } from '../services/api.js';
import { useToasts } from '../context/ToastContext.jsx';
import ValidatedForm from './ValidatedForm.jsx';
import ReferenceLookup from './ReferenceLookup.jsx';
import ToastMessage from './ToastMessage.jsx';
const references = ['department', 'manager', 'location', 'organization', 'division', 'costCenter'];
const textFields = [
  'givenName',
  'familyName',
  'preferredName',
  'title',
  'employeeNumber',
  'employeeType',
  'workPhone',
  'mobilePhone',
  'streetAddress',
  'city',
  'region',
  'postalCode',
  'country',
  'locale',
  'timezone',
];
const label = (key) =>
  ({ employeeNumber: 'Employee ID', costCenter: 'Cost Center', timezone: 'Time Zone' })[key] ||
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
export default function WorkforceProfile(props) {
  const [profile, { refetch, mutate }] = createResource(
    () => props.userId,
    (id) => api(`/api/helpdesk/workforce-profiles/${id}`),
  );
  const { refreshSession } = useSession();
  const { session } = useSession();
  const [pictureVersion, setPictureVersion] = createSignal(0);
  let pictureInput;
  let palette;
  async function uploadPicture(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notify({ tone: 'error', message: 'Choose a picture up to 5 MB.' });
      return;
    }
    setBusy(true);
    try {
      await api('/api/helpdesk/profile-picture', {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      setPictureVersion((value) => value + 1);
      await refreshSession();
      notify({ tone: 'success', message: 'Profile picture saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
      if (pictureInput) pictureInput.value = '';
    }
  }
  const [name, setName] = createSignal('');
  const [editing, setEditing] = createSignal(false);
  const [fields, setFields] = createSignal({});
  const [busy, setBusy] = createSignal(false);
  const [options, { refetch: refreshOptions }] = createResource(
    () => editing(),
    (enabled) => (enabled ? api('/api/helpdesk/reference-records') : null),
  );
  const { notify } = useToasts();
  createEffect(() => {
    if (!profile.error && profile()) {
      setFields({ ...profile().fields });
      setName(profile().name);
    }
  });
  const change = (key, value) => setFields((current) => ({ ...current, [key]: value }));
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      mutate(
        await api(`/api/helpdesk/workforce-profiles/${props.userId}`, {
          method: 'PUT',
          body: JSON.stringify({
            version: profile().version,
            name: name(),
            ...(profile().canEditFields ? { fields: fields() } : {}),
          }),
        }),
      );
      await refreshSession();
      setEditing(false);
      props.onSaved?.();
      notify({ tone: 'success', message: 'Profile saved.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  function beginEdit() {
    if (!profile()?.canEdit || editing()) return;
    setFields({ ...profile().fields });
    setName(profile().name);
    setEditing(true);
  }
  const referenceOptions = (key) =>
    key === 'manager'
      ? (options()?.users || [])
          .filter((user) => user.id !== props.userId)
          .map((user) => ({
            value: user.id,
            label: user.name,
            href: `/workspace/users/${user.id}`,
          }))
      : (options()?.references || [])
          .filter((record) => record.type === key)
          .map((record) => ({
            value: record.id,
            label: record.name,
            href: `/workspace/data/ref-${record.type === 'costCenter' ? 'cost-center' : record.type}/records/${record.id}`,
          }));
  return (
    <section class="workforce-profile">
      <Show when={props.showTitle}>
        <div
          class="profile-cover"
          style={{
            background: `linear-gradient(115deg, ${(profile()?.coverThemes?.find((theme) => theme.id === profile()?.coverTheme)?.colors || ['#152d47', '#255a77', '#173149']).join(', ')})`,
          }}
        >
          <Show when={profile()?.canEditCover}>
            <button
              type="button"
              class="workspace-button secondary small profile-cover-edit"
              aria-label="Change profile cover theme"
              popovertarget={`profile-cover-${props.userId}`}
            >
              <Icon name="edit" /> Cover Theme
            </button>
            <div
              ref={palette}
              id={`profile-cover-${props.userId}`}
              popover="auto"
              class="profile-cover-palette"
            >
              <h3>Cover Theme</h3>
              <For each={profile()?.coverThemes || []}>
                {(theme) => (
                  <button
                    type="button"
                    class="profile-theme-option"
                    aria-pressed={profile()?.coverTheme === theme.id}
                    disabled={busy()}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(`/api/helpdesk/workforce-profiles/${props.userId}/cover`, {
                          method: 'PUT',
                          body: JSON.stringify({ theme: theme.id }),
                        });
                        mutate((current) => ({ ...current, coverTheme: theme.id }));
                        palette.hidePopover();
                        notify({ tone: 'success', message: 'Cover theme saved.' });
                      } catch (error) {
                        notify({ tone: 'error', message: error.message });
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <span
                      style={{ background: `linear-gradient(115deg, ${theme.colors.join(', ')})` }}
                    />
                    {theme.name}
                    <Show when={profile()?.coverTheme === theme.id}>
                      <Icon name="check" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
        <div class="profile-identity-header">
          <ProfileAvatar
            large
            userId={props.userId}
            name={profile()?.name}
            refreshKey={pictureVersion()}
          />
          <div>
            <h2>
              <Show when={!profile.loading} fallback={<Skeleton label="Loading name" lines={1} />}>
                {profile()?.name}
              </Show>
            </h2>
            <p>{profile()?.fields?.title || profile()?.email}</p>
          </div>
          <Show when={session()?.user?.id === props.userId}>
            <input
              ref={pictureInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Upload profile picture up to 5 MB"
              hidden
              onChange={(event) => uploadPicture(event.currentTarget.files?.[0])}
            />
            <button
              type="button"
              class="workspace-button secondary small"
              disabled={busy()}
              onClick={() => pictureInput.click()}
            >
              Change Photo
            </button>
          </Show>
        </div>
      </Show>
      <div class="connections-heading">
        <Show when={props.showTitle}>
          <PageHeading title="Profile" />
        </Show>
        <Show when={!profile.error && profile()?.canEdit}>
          <div class="helpdesk-actions">
            <Show
              when={editing()}
              fallback={
                <button class="workspace-button secondary small" onClick={beginEdit}>
                  Edit Profile
                </button>
              }
            >
              <button
                class="workspace-button small"
                form="workforce-profile-form"
                disabled={busy()}
              >
                Save Changes
              </button>
              <button
                class="workspace-button secondary small"
                disabled={busy()}
                onClick={() => {
                  setFields({ ...profile().fields });
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <Show when={profile.error}>
        <ToastMessage tone="error">{profile.error.message}</ToastMessage>
      </Show>
      <Show
        when={!profile.error && profile()}
        fallback={
          <div class="workforce-profile-grid">
            <For each={Array.from({ length: 23 })}>
              {() => (
                <div class="data-field-skeleton">
                  <Skeleton label="Loading label" lines={1} />
                  <Skeleton label="Loading field" lines={1} />
                </div>
              )}
            </For>
          </div>
        }
      >
        <Show when={profile()?.source === 'identity-provider'}>
          <p class="profile-managed-label">Managed by Identity Provider</p>
        </Show>
        <ValidatedForm
          id="workforce-profile-form"
          class="create-form workforce-profile-form"
          onSubmit={save}
        >
          <div class="workforce-profile-grid">
            <div class="editable-profile-field" onDblClick={beginEdit}>
              <label>
                Name
                <input
                  name="name"
                  required
                  maxlength="160"
                  readOnly={!editing()}
                  disabled={busy()}
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </label>
              <Show when={profile()?.canEdit && !editing()}>
                <button
                  type="button"
                  class="field-edit-button"
                  aria-label="Edit Name"
                  onClick={beginEdit}
                >
                  <Icon name="edit" />
                </button>
              </Show>
            </div>
            <For each={['email']}>
              {(key) => (
                <label>
                  {label(key)}
                  <input readonly value={profile()?.[key] || ''} />
                </label>
              )}
            </For>
            <For each={[...textFields, ...references]}>
              {(key) => (
                <div class="editable-profile-field" onDblClick={beginEdit}>
                  <Show
                    when={references.includes(key)}
                    fallback={
                      <label>
                        {label(key)}
                        <Show
                          when={key === 'timezone'}
                          fallback={
                            <input
                              name={key}
                              maxlength="160"
                              readOnly={!editing() || !profile()?.canEditFields}
                              disabled={busy()}
                              value={fields()[key] || ''}
                              onInput={(event) => change(key, event.currentTarget.value)}
                            />
                          }
                        >
                          <Dropdown
                            name="timezone"
                            ariaLabel="Time Zone"
                            value={fields().timezone || 'UTC'}
                            options={timeZoneOptions(fields().timezone)}
                            readOnly={!editing() || !profile()?.canEditFields}
                            disabled={busy()}
                            onChange={(value) => change('timezone', value)}
                          />
                        </Show>
                      </label>
                    }
                  >
                    <Show
                      when={editing() && profile()?.canEditFields}
                      fallback={
                        <label>
                          {label(key)}
                          <span class="readonly-reference-control">
                            <input readonly value={profile()?.labels[fields()[key]] || ''} />
                            <ReferenceArrow
                              href={
                                referenceOptions(key).find((item) => item.value === fields()[key])
                                  ?.href
                              }
                              label={label(key)}
                            />
                          </span>
                        </label>
                      }
                    >
                      <ReferenceLookup
                        label={label(key)}
                        name={key}
                        disabled={busy() || options.loading}
                        value={fields()[key] || ''}
                        onChange={(value) => change(key, value)}
                        options={referenceOptions(key)}
                      />
                    </Show>
                  </Show>
                  <Show when={profile()?.canEditFields && !editing()}>
                    <button
                      type="button"
                      class="field-edit-button"
                      aria-label={`Edit ${label(key)}`}
                      onClick={beginEdit}
                    >
                      <Icon name="edit" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </ValidatedForm>
      </Show>
    </section>
  );
}
