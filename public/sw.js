// PractiReel service worker: shows reel notifications and opens the reel when tapped. No offline caching.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'PractiReel', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'PractiReel', {
    body: data.body || '', tag: data.tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: data.url || '/' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) { if ('focus' in client) { client.navigate(url); return client.focus(); } }
    return self.clients.openWindow(url);
  }));
});
