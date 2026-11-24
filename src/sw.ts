/// <reference lib="webworker" />
// Service worker: caches the app shell so it opens instantly / offline, and
// shows push notifications sent by the push-send Edge Function.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

type Payload = { title?: string; body?: string; url?: string; tag?: string };

// iPhone requires every push to show a notification, so always show one.
self.addEventListener('push', (event) => {
  let p: Payload = {};
  try { p = event.data?.json() ?? {}; } catch { p = { body: event.data?.text() }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(p.title || 'Picklr Media Hub', {
      body: p.body || '',
      icon: 'pwa-192x192.png',
      badge: 'pwa-64x64.png',
      tag: p.tag,
      data: { url: p.url || '/' },
    });
    // Red dot on the app icon (where supported)
    await (self.navigator as Navigator & { setAppBadge?: () => Promise<void> }).setAppBadge?.().catch(() => {});
  })());
});

// Tap a notification → open (or focus) the app on that page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = (event.notification.data?.url as string) || '/';
  const target = new URL(`./#${route.startsWith('/') ? route : `/${route}`}`, self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      await win.focus();
      await (win as WindowClient).navigate(target).catch(() => win.postMessage({ type: 'open', url: route }));
      return;
    }
    await self.clients.openWindow(target);
  })());
});
