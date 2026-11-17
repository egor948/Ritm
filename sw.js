// Service worker: офлайн-кэш оболочки приложения и показ push-уведомлений.
const VERSION = 'ritm-v4.5.4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'config.js', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/logic.js', 'js/store.js', 'js/ui.js', 'js/components.js', 'js/editors.js', 'js/nav.js', 'js/shell.js',
  'js/layers.js', 'js/goals.js', 'js/habits.js', 'js/tasks.js', 'js/today.js', 'js/calendar.js', 'js/settings.js', 'js/sync.js', 'js/push.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Сначала сеть (чтобы обновления приходили сразу), при отсутствии сети — кэш.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // запросы к Supabase не кэшируем
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Ритм', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Ритм', {
    body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || '#/today' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '#/today';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { c.postMessage({ type: 'open', url }); return c.focus(); }
    }
    return self.clients.openWindow('./' + url);
  }));
});
