// ════════════════════════════════════════════════════════════
// _shared/mobile.js — 移动端通用：汉堡菜单 + sidebar 抽屉
// 自动注入：所有页面只需 <script src="/_shared/mobile.js" defer></script>
// ════════════════════════════════════════════════════════════

(function () {
  function init() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const header  = document.querySelector('.header');
    if (!header) return;

    // 1. 注入汉堡按钮（如果没有）
    let menuBtn = document.querySelector('.mobile-menu-btn');
    let menuBtnExisted = !!menuBtn;
    if (!menuBtn) {
      menuBtn = document.createElement('button');
      menuBtn.className = 'mobile-menu-btn';
      menuBtn.setAttribute('aria-label', '菜单');
      menuBtn.innerHTML = '☰';
      header.insertBefore(menuBtn, header.firstChild);
    }

    // 2. 注入遮罩（兼容 dashboard.html 已有的 sidebar-overlay）
    let overlay = document.querySelector('.mobile-sidebar-overlay, #sidebarOverlay, .sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'mobile-sidebar-overlay';
      document.body.appendChild(overlay);
    }

    function openSb()  {
      sidebar.classList.add('mobile-open');
      overlay.classList.add('active');
    }
    function closeSb() {
      sidebar.classList.remove('mobile-open');
      overlay.classList.remove('active');
    }

    // 只在按钮是我们新建的情况下加监听（避免和 dashboard inline onclick 重复触发）
    if (!menuBtnExisted) {
      menuBtn.addEventListener('click', () => {
        sidebar.classList.contains('mobile-open') ? closeSb() : openSb();
      });
    }
    overlay.addEventListener('click', closeSb);

    // 点击侧栏内任意 nav-item 后自动关闭
    sidebar.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item, a');
      if (item && window.innerWidth <= 768) {
        setTimeout(closeSb, 120);
      }
    });

    // 暴露给页面用（兼容 dashboard 已有的 toggleMobileSidebar/closeMobileSidebar 调用）
    window.toggleMobileSidebar = () => sidebar.classList.contains('mobile-open') ? closeSb() : openSb();
    window.closeMobileSidebar  = closeSb;
    window.openMobileSidebar   = openSb;

    // 视口变窄时若 sidebar 还在桌面态，确保不挡内容
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeSb();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
