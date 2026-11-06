import { renderToStringAsync } from 'solid-js/web';
import PublicApp from './PublicApp.jsx';

export function renderPublicPage(url) {
  return renderToStringAsync(() => <PublicApp url={url} />);
}
