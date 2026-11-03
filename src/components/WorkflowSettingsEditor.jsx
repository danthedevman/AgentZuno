import { createResource, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { api } from '../services/api.js';
import ReferenceLookup from './ReferenceLookup.jsx';
import A from './WorkspaceLink.jsx';
import Dropdown from './Dropdown.jsx';
import CatalogItemImage from './CatalogItemImage.jsx';
import { useToasts } from '../context/ToastContext.jsx';
import { confirmAction } from '../services/confirmations.js';
export default function WorkflowSettingsEditor(props) {
  const { notify } = useToasts();
  const [uploading, setUploading] = createSignal(false);
  async function upload(file) {
    if (!file) return;
    if (
      file.size > 5 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    ) {
      notify({ tone: 'error', message: 'Choose a PNG, JPEG, or WebP image up to 5 MB' });
      return;
    }
    setUploading(true);
    try {
      const saved = await api('/api/helpdesk/catalog-images', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      update({ catalogImageId: saved.id });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setUploading(false);
    }
  }
  const [departments] = createResource(() =>
    api('/api/helpdesk/data/tables/ref-department/options'),
  );
  const [queues] = createResource(() => api('/api/helpdesk/queues'));
  const [categories, { refetch: refreshCategories }] = createResource(() =>
    api('/api/helpdesk/data/tables/ref-catalog-category/options'),
  );
  onMount(() => {
    const refresh = () => refreshCategories();
    window.addEventListener('focus', refresh);
    onCleanup(() => window.removeEventListener('focus', refresh));
  });
  const settings = () => props.value?.settings || {};
  const update = (changes) =>
    props.onChange({ ...props.value, settings: { ...settings(), ...changes } });
  const route = () => props.value.steps.find((step) => ['route', 'handoff'].includes(step.action));
  return (
    <section class="workflow-form-editor create-form" aria-label="Workflow Settings">
      <ReferenceLookup
        label="Department"
        placeholder="Any Department"
        value={props.value.trigger.departmentId || ''}
        options={departments() || []}
        disabled={props.disabled || departments.loading}
        onChange={(id) => {
          const { departmentId, ...trigger } = props.value.trigger;
          props.onChange({
            ...props.value,
            trigger: { ...trigger, department: 'general', ...(id ? { departmentId: id } : {}) },
          });
        }}
      />
      <div class="preference-row">
        <span>Display in Catalog</span>
        <button
          type="button"
          class="toggle-switch"
          role="switch"
          aria-label="Display in Catalog"
          aria-checked={props.value.displayInCatalog || false}
          disabled={props.disabled}
          onClick={() =>
            props.onChange({ ...props.value, displayInCatalog: !props.value.displayInCatalog })
          }
        >
          <span />
        </button>
      </div>
      <label>
        Catalog Description
        <textarea
          maxlength="500"
          rows="3"
          value={settings().description || ''}
          disabled={props.disabled}
          onInput={(event) => update({ description: event.currentTarget.value })}
        />
      </label>
      <Show when={props.value.displayInCatalog}>
        <label>
          Catalog Item Icon
          <Dropdown
            ariaLabel="Catalog item icon"
            value={settings().catalogIcon || 'catalog'}
            disabled={props.disabled}
            options={[
              'catalog',
              'laptop',
              'software',
              'phone',
              'help',
              'book',
              'users',
              'task',
            ].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
            onChange={(catalogIcon) => update({ catalogIcon })}
          />
        </label>
        <div class="catalog-image-settings">
          <CatalogItemImage imageId={settings().catalogImageId} icon={settings().catalogIcon} />
          <label>
            Catalog Image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={props.disabled || uploading()}
              onChange={(event) => upload(event.currentTarget.files?.[0])}
            />
          </label>
          <Show when={uploading()}>
            <span role="status">Uploading image…</span>
          </Show>
          <Show when={settings().catalogImageId}>
            <button
              class="workspace-button secondary small"
              type="button"
              disabled={props.disabled}
              onClick={async () => {
                if (
                  await confirmAction(
                    'Remove this image from the catalog item?',
                    'Remove Catalog Image',
                    'Remove',
                  )
                )
                  update({ catalogImageId: '' });
              }}
            >
              Use Icon Instead
            </button>
          </Show>
        </div>
        <div class="catalog-category-field">
          <ReferenceLookup
            label="Catalog Category"
            value={settings().category || ''}
            options={categories() || []}
            disabled={props.disabled || categories.loading}
            onChange={(category) => update({ category })}
          />
          <A
            class="workspace-button secondary small"
            href="/workspace/data/ref-catalog-category/records/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            Add Category ↗
          </A>
        </div>
      </Show>
      <ReferenceLookup
        label="Default Assignment Group"
        value={route()?.params.queueName || ''}
        disabled={props.disabled || queues.loading || !route()}
        options={(queues() || []).map((queue) => ({
          value: queue.name,
          label: queue.name,
          href: `/workspace/users/groups/${queue.groupId || queue.id}`,
        }))}
        onChange={(queueName) =>
          props.onChange({
            ...props.value,
            steps: props.value.steps.map((step) =>
              step.id === route()?.id ? { ...step, params: { ...step.params, queueName } } : step,
            ),
          })
        }
      />
      <label>
        Post-Submission Message
        <textarea
          maxlength="500"
          rows="3"
          value={settings().submissionMessage || ''}
          disabled={props.disabled}
          onInput={(event) => update({ submissionMessage: event.currentTarget.value })}
        />
      </label>
      <For
        each={[
          {
            key: 'timeoutSeconds',
            label: 'Execution Timeout (Seconds)',
            min: 5,
            max: 60,
            value: 60,
          },
          { key: 'maxConcurrentRuns', label: 'Maximum Concurrent Runs', min: 1, max: 10, value: 2 },
        ]}
      >
        {(field) => (
          <label>
            {field.label}
            <input
              type="number"
              min={field.min}
              max={field.max}
              step="1"
              value={settings()[field.key] ?? field.value}
              disabled={props.disabled}
              onChange={(event) => update({ [field.key]: Number(event.currentTarget.value) })}
            />
          </label>
        )}
      </For>
      <p class="field-help">
        Changes apply after publication. Worker capacity can further limit concurrency.
      </p>
    </section>
  );
}
