/**
 * Client plugin — registers the Service Worker for PWA offline support.
 * Only runs in production (not during SSR).
 */
export default defineNuxtPlugin(() => {
  if (import.meta.client && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/xianyu/sw.js', { scope: '/xianyu/' })
        .catch(() => {
          // SW registration failed — silently ignore
        })
    })
  }
})
