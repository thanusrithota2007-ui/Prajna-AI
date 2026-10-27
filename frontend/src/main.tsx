import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are self-hosted (bundled by Vite), so the page makes no third-party font requests.
import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import '@fontsource/noto-serif-devanagari/devanagari-400.css';
import '@fontsource/noto-serif-devanagari/devanagari-600.css';
// Global styles must load before component styles so component rules can refine them.
import './styles/global.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
