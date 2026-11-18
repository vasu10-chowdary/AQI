import './styles.css';
import { init } from './app.js';

try {
  init();
} finally {
  // Reveal the sections now that they have their real content (see index.html).
  document.documentElement.classList.remove('js-loading');
}
