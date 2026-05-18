/* ════════════════════════════════════════════════════════════
   _shared/i18n.js — 统一 i18n 字典 + applyI18n
   用法：
     <script src="_shared/i18n.js"></script>
     <span data-i18n="navDashboard">仪表盘</span>
     <button class="lang-btn" onclick="CRM.toggleLang()">中/EN</button>
     CRM.applyI18n();
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  if (!window.CRM) window.CRM = {};

  const KEY = 'crm_lang';

  // 统一词典（所有页面共享，新加 key 在这里加一次即可）
  const DICT = {
    zh: {
      // sidebar
      navMain: '主菜单', navAmazon: '亚马逊运营', navTools: '工具',
      navDashboard: '仪表盘', navOrders: '订单管理', navCustomers: '客户管理',
      navProducts: '产品管理', navLogistics: '物流管理',
      navMargin: '产品毛利', navInventory: '库存补货', navResearch: '竞品调研', navAds: '广告管理',
      navDocuments: '文档制作', navEmail: '邮件', navPasswordVault: '密码保险柜', navAI: 'AI 助手',

      // common
      btnSave: '保存', btnCancel: '取消', btnDelete: '删除', btnEdit: '编辑',
      btnAdd: '新增', btnClose: '关闭', btnRefresh: '刷新', btnImport: '导入',
      btnExport: '导出', btnSearch: '搜索', btnConfirm: '确认',

      // table
      thName: '名称', thDate: '日期', thStatus: '状态', thActions: '操作',
      thNotes: '备注',

      // toast
      tSaved: '已保存', tDeleted: '已删除', tFailed: '操作失败',

      // dashboard / orders
      dashTitle: '仪表盘', ordersTitle: '订单管理',
    },
    en: {
      navMain: 'MAIN', navAmazon: 'Amazon Ops', navTools: 'TOOLS',
      navDashboard: 'Dashboard', navOrders: 'Orders', navCustomers: 'Customers',
      navProducts: 'Products', navLogistics: 'Logistics',
      navMargin: 'Margin', navInventory: 'Inventory', navResearch: 'Research', navAds: 'Ads',
      navDocuments: 'Documents', navEmail: 'Email', navPasswordVault: 'Vault', navAI: 'AI',

      btnSave: 'Save', btnCancel: 'Cancel', btnDelete: 'Delete', btnEdit: 'Edit',
      btnAdd: 'Add', btnClose: 'Close', btnRefresh: 'Refresh', btnImport: 'Import',
      btnExport: 'Export', btnSearch: 'Search', btnConfirm: 'Confirm',

      thName: 'Name', thDate: 'Date', thStatus: 'Status', thActions: 'Actions',
      thNotes: 'Notes',

      tSaved: 'Saved', tDeleted: 'Deleted', tFailed: 'Failed',

      dashTitle: 'Dashboard', ordersTitle: 'Orders',
    },
  };

  function getLang() { return localStorage.getItem(KEY) || 'zh'; }
  function setLang(l) { localStorage.setItem(KEY, l); }
  function t(key) {
    const l = getLang();
    return (DICT[l] && DICT[l][key]) || (DICT.zh && DICT.zh[key]) || key;
  }
  // 合并页面级字典（每个页面可注册自己的特有 key，不污染全局）
  function extend(extra) {
    if (!extra) return;
    for (const lang of Object.keys(extra)) {
      DICT[lang] = Object.assign(DICT[lang] || {}, extra[lang]);
    }
  }
  function applyI18n(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      const v = t(k);
      if (v) el.textContent = v;
    });
    r.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      const v = t(k);
      if (v) el.setAttribute('placeholder', v);
    });
    // 同步 lang-btn 文本
    document.querySelectorAll('.lang-btn').forEach(b => { b.textContent = getLang() === 'zh' ? 'EN' : '中'; });
  }
  function toggleLang() {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    applyI18n();
  }

  Object.assign(window.CRM, { t, getLang, setLang, toggleLang, applyI18n, extendI18n: extend });
})();
