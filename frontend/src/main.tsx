import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Apply the saved (or OS) theme before first paint.
let theme: string | null = null;
try {
  theme = localStorage.getItem('sprout.theme');
} catch {
  // storage unavailable
}
document.documentElement.dataset.theme =
  theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
