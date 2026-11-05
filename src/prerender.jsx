import { renderToStringAsync } from 'solid-js/web';
import { StaticRouter, Route } from '@solidjs/router';
import { PublicSessionProvider } from './context/SessionContext.jsx';
import HomePage from './pages/HomePage.jsx';
import DocsPage from './pages/DocsPage.jsx';

export function renderPublicPage(url) {
  return renderToStringAsync(() => (
    <StaticRouter
      url={url}
      base={import.meta.env.BASE_URL.replace(/\/$/, '')}
      root={(props) => <PublicSessionProvider>{props.children}</PublicSessionProvider>}
    >
      <Route path="/" component={HomePage} />
      <Route path="/docs" component={DocsPage} />
      <Route path="/docs/workflows" component={DocsPage} />
    </StaticRouter>
  ));
}
