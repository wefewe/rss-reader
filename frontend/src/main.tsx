import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './index.css'

// Register Service Worker for PWA with automatic takeover and single-reload guard
if ('serviceWorker' in navigator) {
  let refreshing = false;
  // If the page was already controlled by a service worker on load,
  // a controllerchange event means a new service worker took over.
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      // First install: initial page is already fresh from network, no reload needed.
      return;
    }
    if (refreshing) return;

    // Guard against reload loops: allow at most one auto-reload per session/version window (10s)
    const lastReloadKey = 'sw_controller_last_reload';
    const lastReload = sessionStorage.getItem(lastReloadKey);
    const now = Date.now();
    if (lastReload && now - parseInt(lastReload, 10) < 10000) {
      console.warn('[SW] Reload loop prevented, last auto-reload was within 10s');
      return;
    }

    sessionStorage.setItem(lastReloadKey, now.toString());
    refreshing = true;
    console.log('[SW] New ServiceWorker active & claimed clients. Auto-reloading page once...');
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('[SW] Registered with scope:', registration.scope);

        // Actively check for updates on load
        registration.update().catch((err) => {
          console.warn('[SW] Update check error:', err);
        });

        // If a new worker is found and waiting, notify it to skipWaiting
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version installed and waiting, requesting skipWaiting...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      })
      .catch((error) => {
        console.warn('[SW] Registration failed:', error);
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
