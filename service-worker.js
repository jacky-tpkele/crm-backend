// TPKELE CRM Service Worker
// 不缓存任何资源（保证 CRM 永远是最新代码），但负责接收 Web Push 离线通知
// iOS 16.4+ 把 PWA 加到主屏幕后即可收到此事件，唤醒锁屏

const SW_VERSION = 'v2-chat-push-2026-05-24';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// fetch 不拦截，全部走网络
self.addEventListener('fetch', (event) => {
  // 故意空：保证不缓存任何业务资源
});

// 收到推送 → 弹通知
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'TPKELE CRM', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'TPKELE CRM';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'tpkele-chat',
    renotify: true,
    data: { url: data.url || '/dashboard.html' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 点通知 → 打开/聚焦 CRM
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard.html';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 已打开就 focus
    for (const c of allClients) {
      try {
        const u = new URL(c.url);
        if (u.pathname === '/dashboard.html' || u.pathname.endsWith('/dashboard.html')) {
          await c.focus();
          if ('navigate' in c) { try { await c.navigate(targetUrl); } catch (_) {} }
          return;
        }
      } catch (_) {}
    }
    // 没打开就新开一个
    await self.clients.openWindow(targetUrl);
  })());
});
