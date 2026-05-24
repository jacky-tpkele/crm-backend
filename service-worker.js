// TPKELE CRM Service Worker —— 极简版本
// 故意不缓存任何资源，避免代码更新被缓存卡住。
// 后续要加离线缓存或推送通知，再扩展这个文件。

const SW_VERSION = 'v1-2026-05-24';

self.addEventListener('install', (event) => {
  // 跳过 waiting，让新 SW 立刻接管
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 立刻控制所有打开的页面
  event.waitUntil(self.clients.claim());
});

// fetch 不拦截，全部走网络（保证 CRM 永远是最新代码）
self.addEventListener('fetch', (event) => {
  // 故意不调用 event.respondWith，浏览器走默认网络请求
});
