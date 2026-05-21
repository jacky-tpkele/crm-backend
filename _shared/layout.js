/* ════════════════════════════════════════════════════════════
   _shared/layout.js — 公共 JS：auth / api / toast / sidebar
   用法：在 <head> 引 <script src="_shared/layout.js"></script>
        然后挂个 <div id="sidebar"></div> + 调 CRM.mountSidebar('current-page')
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── token 管理 + auth check ──
  const TOKEN_KEY = 'crm_token';
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('crm_username');
    localStorage.removeItem('crm_user');
  }
  function requireAuth() {
    if (!getToken()) { location.href = '/login.html'; return false; }
    return true;
  }

  // ── 统一 fetch wrapper：自带 Authorization、401 自动跳登录 ──
  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const body = opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body;
    const res = await fetch(path, { ...opts, headers, body });
    if (res.status === 401) { clearAuth(); location.href = '/login.html'; throw new Error('Unauthorized'); }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
    return data;
  }

  // ── Toast ──
  let toastEl = null;
  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.querySelector('.toast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.id = 'toast';
      document.body.appendChild(toastEl);
    }
    return toastEl;
  }
  function showToast(msg, type) {
    const el = ensureToast();
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    setTimeout(() => { el.className = 'toast'; }, 2500);
  }

  // ── Sidebar 配置（一处定义，所有页共享）──
  // 按访问顺序排列：核心 → 亚马逊运营 → 工具
  const NAV = [
    { group: '主菜单' },
    { id: 'dashboard',         icon: '📊', label: '仪表盘',     href: 'dashboard.html' },
    { id: 'orders',            icon: '◍',  label: '订单管理',    href: 'dashboard.html#orders' },
    { id: 'customers',         icon: '👥', label: '客户管理',    href: 'dashboard.html#customers' },
    { id: 'products',          icon: '📦', label: '产品管理',    href: 'dashboard.html#products' },
    { id: 'inquiries',         icon: '📋', label: '网站询盘',    href: 'inquiries.html' },
    { id: 'logistics',         icon: '🚚', label: '物流管理',    href: 'logistics.html' },

    { group: '亚马逊运营' },
    { id: 'amazon-margin',     icon: '💰', label: '产品毛利',    href: 'amazon-margin.html' },
    { id: 'amazon-inventory',  icon: '📦', label: '库存补货',    href: 'amazon-inventory.html' },
    { id: 'amazon-research',   icon: '🔍', label: '竞品调研',    href: 'amazon-research.html' },
    { id: 'amazon-ads',        icon: '📢', label: '广告管理',    href: 'amazon-ads.html' },

    { group: '工具' },
    { id: 'documents',         icon: '📄', label: '文档制作',    href: 'documents.html' },
    { id: 'email',             icon: '✉',  label: '邮件',        href: 'email.html' },
    { id: 'password-vault',    icon: '🔐', label: '密码保险柜',  href: 'password-vault.html' },
    { id: 'ai',                icon: '🤖', label: 'AI 助手',     href: 'ai.html', target: '_blank' },
  ];

  function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

  // 渲染侧边栏到目标元素。currentId = 当前页 id（高亮用）
  function mountSidebar(currentId, target) {
    const root = (target && (typeof target === 'string' ? document.querySelector(target) : target))
              || document.getElementById('sidebar')
              || (function () { const d = document.createElement('div'); d.id = 'sidebar'; document.body.insertBefore(d, document.body.firstChild); return d; })();

    let html = '<div class="sidebar"><div class="sb-logo"><div class="logo-text">TP<span>KELE</span></div></div><div class="sb-nav">';
    for (const item of NAV) {
      if (item.group) {
        html += '<div class="nav-group">' + escAttr(item.group) + '</div>';
        continue;
      }
      const active = item.id === currentId ? ' active' : '';
      const target = item.target ? ' target="' + escAttr(item.target) + '"' : '';
      html += '<a class="nav-item' + active + '" href="' + escAttr(item.href) + '"' + target + '>'
            + '<span class="nav-icon">' + item.icon + '</span>'
            + '<span>' + escAttr(item.label) + '</span></a>';
    }
    html += '</div></div>';
    root.outerHTML = html;
  }

  // 暴露
  window.CRM = {
    api,
    showToast,
    getToken, setToken, clearAuth, requireAuth,
    mountSidebar,
    NAV,
  };

  // 自动 auth check：页面里如果有 <body data-auth-required> 就强制要求登录
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.hasAttribute('data-auth-required')) requireAuth();
  });
})();
