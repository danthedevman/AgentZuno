import MultiSelectLookup from './MultiSelectLookup.jsx';

export default function ReferenceLookup(props) {
  return (
    <MultiSelectLookup
      single
      label={props.label}
      name={props.name}
      options={props.options}
      value={props.value ? [props.value] : []}
      onChange={(values) => props.onChange?.(values[0] || '')}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      placeholder={props.placeholder}
    />
  );
}
