/* ════════════════════════════════════════════════════════════
   _shared/theme.js — CODEX 主题切换（light / dark）
   在 <head> 中同步加载（不要加 defer），避免首屏闪白/闪黑。
   状态存 localStorage.crm_theme，默认 light。
   ════════════════════════════════════════════════════════════ */
(function () {
  var KEY = 'crm_theme';
  var saved;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  var theme = (saved === 'dark' || saved === 'light') ? saved : 'light';
  document.documentElement.setAttribute('data-theme', theme);

  // 同步 PWA 状态栏颜色
  function syncMeta(t) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0a0a0a' : '#ffffff');
  }

  function syncIcon(t) {
    var btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = t === 'dark' ? '☾' : '☀';
  }

  window.toggleTheme = function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    var next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) {}
    syncMeta(next);
    syncIcon(next);
    // 让图表等监听者可以重绘
    window.dispatchEvent(new CustomEvent('crm-theme-change', { detail: { theme: next } }));
  };

  window.getTheme = function () {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { syncMeta(theme); syncIcon(theme); });
  } else {
    syncMeta(theme); syncIcon(theme);
  }
})();
