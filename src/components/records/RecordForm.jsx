import { isMultilineField } from '../../utils/recordFields.js';
import { Index, Show } from 'solid-js';
import ValidatedForm from '../ValidatedForm.jsx';
import RecordField from './RecordField.jsx';

export default function RecordForm(props) {
  const sections = () => props.sections || [{ fields: props.fields || [] }];
  return (
    <ValidatedForm
      id={props.id}
      class="create-form record-surface record-property-sheet"
      onSubmit={props.onSubmit}
    >
      <Index each={sections()}>
        {(section) => (
          <section class="record-section" aria-label={section().title}>
            <Show when={section().title}>
              <h2>{section().title}</h2>
            </Show>
            <div class="record-property-list">
              <Index each={section().fields.filter((field) => field.visible !== false)}>
                {(field) => (
                  <div
                    classList={{
                      'record-description-block':
                        props.detailsOnly &&
                        (field().descriptionBlock ?? isMultilineField(field())),
                    }}
                  >
                    <RecordField
                      field={field()}
                      value={props.values?.[field().id]}
                      detailsOnly={props.detailsOnly}
                      readOnly={props.readOnly || props.readOnlyFields?.includes(field().id)}
                      disabled={props.disabled}
                      includeDemo={props.includeDemo}
                      onChange={(value) => props.onChange?.(field().id, value)}
                    />
                  </div>
                )}
              </Index>
            </div>
          </section>
        )}
      </Index>
      {props.children}
    </ValidatedForm>
  );
}
