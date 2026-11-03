import { render } from 'solid-js/web';
import App from './App.jsx';
import '@fontsource-variable/inter';
import '@fontsource/shippori-mincho/latin-400.css';
import '@fontsource/shippori-mincho/latin-500.css';
import './styles.css';
import './workspace.css';

render(() => <App />, document.querySelector('#root'));
