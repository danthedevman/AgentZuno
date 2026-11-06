import { confirmAction } from '../../services/confirmations.js';
import ReferenceLookup from '../ReferenceLookup.jsx';
import { api } from '../../services/api.js';
import { For, Show, createEffect, createResource } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import Dropdown from '../Dropdown.jsx';

export default function WorkflowRoutingEditor(props) {
  const [queues] = createResource(() =>
    api(`/api/helpdesk/queues?reference=1${props.includeDemo ? '&includeDemo=1' : ''}`),
  );
  const [rules, setRules] = createStore([]);
  createEffect(() => setRules(reconcile(props.rules || [], { key: 'id' })));
  const fields = () => props.form?.fields || [];
  const update = (id, changes) =>
    props.onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...changes } : rule)));
  const conditionFor = (field) => ({
    fieldId: field.id,
    operator: 'equals',
    value: field.type === 'boolean' ? true : field.options?.[0] || '',
  });
  const updateCondition = (rule, index, changes) =>
    update(rule.id, {
      conditions: rule.conditions.map((condition, position) =>
        position === index ? { ...condition, ...changes } : condition,
      ),
    });
  return (
    <section class="workflow-form-editor" aria-label="Conditional Routing">
      <h2>Conditional Routing</h2>
      <p>
        Rules run from top to bottom. The first match wins. Otherwise, the default workflow queue
        applies.
      </p>
      <For each={rules}>
        {(rule, index) => (
          <fieldset class="workflow-form-field create-form" disabled={props.disabled}>
            <legend>Rule {index() + 1}</legend>
            <label>
              Match
              <Dropdown
                ariaLabel={`Match for Rule ${index() + 1}`}
                value={rule.match}
                options={[
                  { value: 'all', label: 'All Conditions' },
                  { value: 'any', label: 'Any Condition' },
                ]}
                onChange={(match) => update(rule.id, { match })}
              />
            </label>
            <For each={rule.conditions}>
              {(condition, position) => {
                const field = () => fields().find((item) => item.id === condition.fieldId);
                return (
                  <div class="create-form">
                    <label>
                      Form Field
                      <Dropdown
                        ariaLabel="Condition Form Field"
                        value={condition.fieldId}
                        options={fields().map((item) => ({ value: item.id, label: item.label }))}
                        onChange={(id) =>
                          updateCondition(
                            rule,
                            position(),
                            conditionFor(fields().find((item) => item.id === id)),
                          )
                        }
                      />
                    </label>
                    <label>
                      Comparison
                      <Dropdown
                        ariaLabel="Condition Comparison"
                        value={condition.operator}
                        options={[
                          { value: 'equals', label: 'Equals' },
                          { value: 'not-equals', label: 'Does Not Equal' },
                        ]}
                        onChange={(operator) => updateCondition(rule, position(), { operator })}
                      />
                    </label>
                    <label>
                      Value
                      <Show
                        when={field()?.type === 'boolean' || field()?.type === 'select'}
                        fallback={
                          <input
                            maxlength="2000"
                            value={condition.value}
                            onInput={(event) =>
                              updateCondition(rule, position(), {
                                value: event.currentTarget.value,
                              })
                            }
                          />
                        }
                      >
                        <Dropdown
                          ariaLabel="Condition Value"
                          value={String(condition.value)}
                          options={
                            field()?.type === 'boolean'
                              ? [
                                  { value: 'true', label: 'Yes' },
                                  { value: 'false', label: 'No' },
                                ]
                              : (field()?.options || []).map((value) => ({ value, label: value }))
                          }
                          onChange={(value) =>
                            updateCondition(rule, position(), {
                              value: field()?.type === 'boolean' ? value === 'true' : value,
                            })
                          }
                        />
                      </Show>
                    </label>
                    <Show when={rule.conditions.length > 1}>
                      <button
                        type="button"
                        class="workspace-button secondary small"
                        onClick={async () => {
                          if (!(await confirmAction('Remove this routing condition?'))) return;
                          update(rule.id, {
                            conditions: rule.conditions.filter((_, i) => i !== position()),
                          });
                        }}
                      >
                        Remove Condition
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
            <button
              type="button"
              class="workspace-button secondary small"
              disabled={rule.conditions.length >= 10 || !fields().length}
              onClick={() =>
                update(rule.id, { conditions: [...rule.conditions, conditionFor(fields()[0])] })
              }
            >
              Add Condition
            </button>
            <label>
              Action
              <Dropdown
                ariaLabel="Routing Action"
                value={rule.action}
                options={[
                  { value: 'route', label: 'Route Request' },
                  { value: 'handoff', label: 'Handoff' },
                ]}
                onChange={(action) => update(rule.id, { action })}
              />
            </label>
            <ReferenceLookup
              label="Assignment Group"
              value={rule.queueName}
              options={(queues() || []).map((queue) => ({
                value: queue.name,
                label: queue.name,
                href: `/workspace/users/groups/${queue.groupId || queue.id}`,
              }))}
              disabled={props.disabled || queues.loading}
              onChange={(queueName) => update(rule.id, { queueName })}
            />
            <div class="workflow-form-heading">
              <button
                type="button"
                class="workspace-button secondary small"
                disabled={index() === 0}
                onClick={() => {
                  const next = [...rules];
                  [next[index() - 1], next[index()]] = [next[index()], next[index() - 1]];
                  props.onChange(next);
                }}
              >
                Move Up
              </button>
              <button
                type="button"
                class="workspace-button secondary small"
                onClick={async () => {
                  if (await confirmAction('Remove this routing rule?'))
                    props.onChange(rules.filter((item) => item.id !== rule.id));
                }}
              >
                Remove Rule
              </button>
            </div>
          </fieldset>
        )}
      </For>
      <button
        type="button"
        class="workspace-button secondary small"
        disabled={props.disabled || !fields().length || rules.length >= 20}
        onClick={() =>
          props.onChange([
            ...rules,
            {
              id: `rule-${crypto.randomUUID().slice(0, 8)}`,
              match: 'all',
              conditions: [conditionFor(fields()[0])],
              action: 'route',
              queueName: 'Support',
            },
          ])
        }
      >
        Add Routing Rule
      </button>
    </section>
  );
}
