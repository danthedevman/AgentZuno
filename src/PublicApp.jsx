import { Router, Route } from '@solidjs/router';
import { onMount } from 'solid-js';
import { PublicSessionProvider } from './context/SessionContext.jsx';
import PageMetadata from './components/PageMetadata.jsx';
import HomePage from './pages/public/HomePage.jsx';
import DocsPage from './pages/public/DocsPage.jsx';

export function PublicLayout(props) {
  return (
    <PublicSessionProvider>
      <PageMetadata />
      {props.children}
    </PublicSessionProvider>
  );
}
export function PublicRoutes() {
  return (
    <>
      <Route
        path="/"
        component={import.meta.env.VITE_STATIC_SITE === 'true' ? HomePage : OpenApplication}
      />
      <Route path="/docs" component={DocsPage} />
      <Route path="/docs/:guide" component={DocsPage} />
    </>
  );
}
function OpenApplication() {
  onMount(() => window.location.reload());
  return null;
}
export default function PublicApp() {
  return (
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')} root={PublicLayout}>
      <PublicRoutes />
    </Router>
  );
}
