self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SMARTGUARD: alarm kendaraan', {
    body: d.body || 'Gerakan atau perpindahan mencurigakan terdeteksi.',
    tag: d.event_id || 'smartguard', requireInteraction: d.severity === 'high', data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
