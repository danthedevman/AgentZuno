import Dropdown from './Dropdown.jsx';

export default function CategoryDropdown(props) {
  return (
    <Dropdown
      ariaLabel="Filter app category"
      icon="layers"
      value={props.value}
      onChange={props.onChange}
      options={[
        { value: '', label: 'All categories' },
        ...props.categories.map((category) => ({ value: category, label: category })),
      ]}
    />
  );
}
