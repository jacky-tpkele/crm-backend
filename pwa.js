// TPKELE CRM PWA 注册脚本
// 在每个 HTML 页面的 <head> 末尾通过 <script src="/pwa.js"></script> 引入
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/' })
      .catch(function (err) {
        console.warn('[PWA] Service worker 注册失败：', err);
      });
  });
})();
