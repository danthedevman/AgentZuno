import { render, hydrate } from 'solid-js/web';
import PublicApp from './PublicApp.jsx';
import App from './App.jsx';
import './styles/fonts.css';
import './styles/public.css';
import './styles/workspace.css';

const root = document.querySelector('#root');
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const path = window.location.pathname.slice(base.length).replace(/\/$/, '') || '/';
const isPublic =
  path === '/docs' ||
  path.startsWith('/docs/') ||
  (path === '/' && import.meta.env.VITE_STATIC_SITE === 'true');
if (isPublic && root.querySelector('[data-hk]')) {
  // Public pages retain their server-rendered nodes and layout during startup.
  globalThis._$HY ||= { events: [], completed: new WeakSet(), r: {}, fe() {} };
  hydrate(() => <PublicApp />, root);
} else {
  root.replaceChildren();
  render(() => <App />, root);
}
document.documentElement.classList.add('app-ready');
