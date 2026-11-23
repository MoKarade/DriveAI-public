import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { App } from './App';
import { initialiserTheme } from './theme';
import './fonts.css';
import './styles.css';

// Applique le thème mémorisé (sombre par défaut) avant le premier rendu pour éviter tout flash.
initialiserTheme();

// PWA : enregistrement du service worker minimal (installabilité — passe-plat réseau, zéro cache).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* best-effort */ });
}

// LIA (tâches #650 et #771) a été retirée le 05/11/2026 (ADR-0074) : plus aucun assistant ni appel IA dans l'app.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {import.meta.env.VITE_E2E_MOCK !== 'true' && <Analytics />}
  </StrictMode>,
);
