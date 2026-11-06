import { renderToStringAsync } from 'solid-js/web';
import { StaticRouter } from '@solidjs/router';
import { PublicLayout, PublicRoutes } from './PublicApp.jsx';

export function renderPublicPage(url) {
  return renderToStringAsync(() => (
    <StaticRouter url={url} base={import.meta.env.BASE_URL.replace(/\/$/, '')} root={PublicLayout}>
      <PublicRoutes />
    </StaticRouter>
  ));
}
