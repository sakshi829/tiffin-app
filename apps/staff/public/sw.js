// Amruta's Kitchen: shows alerts when the web app is closed (iPhone home-screen app, browsers).
// It only displays what the kitchen's server sent; it stores nothing and loads nothing else.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { p = {}; }
  const title = typeof p.title === 'string' && p.title ? p.title.slice(0, 80) : "Amruta's Kitchen";
  const body = typeof p.body === 'string' ? p.body.slice(0, 300) : '';
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', data: { url: '/' } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('/');
  }));
});
