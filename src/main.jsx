import { render } from 'solid-js/web';
import App from './App.jsx';
import '@fontsource-variable/inter';
import '@fontsource/shippori-mincho/latin-400.css';
import '@fontsource/shippori-mincho/latin-500.css';
import './styles/public.css';
import './styles/workspace.css';

document.documentElement.classList.add('app-ready');
const root = document.querySelector('#root');
// Public pages include build-time HTML; replace it with the interactive Solid app.
root.replaceChildren();
render(() => <App />, root);
