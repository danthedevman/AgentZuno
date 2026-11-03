import A from './WorkspaceLink.jsx';
import Icon from './Icon.jsx';
export default function BackLink(props) {
  return (
    <A class="page-back-link" href={props.href}>
      <Icon name="back" />
      <span>{props.children || 'Back'}</span>
    </A>
  );
}
