# TPKELE CRM — UI 主题工作状态

> 最后更新：2026-05-09  
> 仓库：`jacky-tpkele/crm-backend` (main)  
> 部署：Vercel → `crm-backend-psi-flame.vercel.app` → 自定义域 `crm.tpkele.com`

---

## 1. 整体方案

所有 UI 改动通过**单一覆盖样式表** [light-theme.css](./light-theme.css)（文件名沿用历史，实际现在是 dark-green 主题）实现，链接在 7 个 HTML 的 `</head>` 之前**最后**加载，靠源顺序 + `!important` 覆盖原内联 `<style>`。

**HTML 改动只有两类：**
1. 每个 HTML `</head>` 前加一行 `<link rel="stylesheet" href="light-theme.css">`
2. `dashboard.html` 注入了：
   - 仪表盘标题旁的 **USD→CNY 实时汇率徽章**（`#fxWidget` + 末尾 `<script>`）
   - Chart.js 的颜色字面量替换（不是逻辑，只是颜色字符串）

**未触碰**任何前/后端业务逻辑、API、数据库、路由、组件结构。

---

## 2. 当前色板（Premium Dark Green）

| 用途 | 颜色 |
|---|---|
| 页面底色 `--bg` | `#0F1F1C` |
| 卡片/面板 `--panel` | `#162623` |
| 子面板/输入框 `--panel-2` | `#1B2E2A` |
| Hover/选中表面 | `#1F3A35` |
| 边框 `--border` | `#244841` |
| 主文本 `--text` | `#E6F4EF` |
| 次文本 `--muted` | `#9DB5AC` |
| **Primary 主色** | `#10B981` (deep space green) |
| Secondary | `#34D399` |
| Accent | `#6EE7B7` |
| Danger | `#ef4444` |
| 字体 | `Microsoft YaHei Light` 全站统一，weight 300 |

---

## 3. 已完成清单

### 3.1 全局
- [x] 字体统一为微软雅黑 Light（标题/strong 用 500）
- [x] 按钮椭圆胶囊形（`border-radius:999px`），透明底 + emerald 描边，hover 半透明 emerald + 微阴影，active scale(.97)
- [x] 主按钮 = 实色 emerald + 深底文字
- [x] 输入框/搜索：深底，焦点 emerald 描边 + 微光环
- [x] 表格：深表头、行 hover 浅亮
- [x] 模态框/下拉：深底 + emerald hover
- [x] 滚动条：深轨道 + emerald hover
- [x] 链接：emerald
- [x] 状态徽章 `.badge/.tag/.status`：胶囊 emerald

### 3.2 侧栏
- [x] 背景比主体更深 `#0B1714`
- [x] 选中项：emerald 内嵌左条 + 薄荷文字
- [x] 一级菜单图标 `.nav-icon`：CSS 绘制空心圆 + 中心小点（hover 放大、active 发光）
- [x] 折叠头 `文件 / 工具`：`::before` 同款圆点指示器
- [x] LOGO：六边形 T 图标隐藏，`TPKELE CRM` 字重 900、字号 22px、字距 3px、大写
- [x] "收起" 按钮等沿用 forest 灰

### 3.3 顶栏
- [x] 用户头像 `.user-avatar`：emerald 实色 + 深底文字
- [x] 铃铛 `.icon-btn[title="Notifications"]`：透明圆，hover 浅亮
- [x] 中/EN、手动制作文件、物流管理、常用密码存储 等按钮：胶囊描边

### 3.4 仪表盘
- [x] KPI 数字 `.green/.cyan/.purple` 三档替换为 `#34D399 / #6EE7B7 / #10B981`
- [x] **USD→CNY 实时汇率徽章**（右上角）
  - 数据源：`api.frankfurter.dev`，兜底 `open.er-api.com`
  - 5 分钟自动刷新
  - 汇率数字 18px 粗体 emerald
- [x] 所有图表（订单/利润/Top产品/Top客户/分析/状态环）色彩重写
- [x] Chart.js 默认字体改成微软雅黑 Light，坐标轴线 `rgba(36,72,65,.6)`
- [x] AI 助手气泡（bot 深底 / user emerald 实色）+ 头像
- [x] 快速导出浮窗：深色 emerald 描边

### 3.5 邮件页
- [x] 文件夹列表 active：emerald 左条 + 薄荷文字
- [x] 邮件列表 hover/active/selected 三档深浅
- [x] 未读 from 字段薄荷色，subject 高亮

### 3.6 登录页
- [x] 顶部 `T 六边形 + TPKELE` 文字隐藏
- [x] 页面背景嵌入 emerald 大字水印 `TPKELE`（6% 透明、18vw、字距 14px、weight 900）
- [x] 指纹环改 emerald 发光（强制覆盖 SVG 内联 stroke/fill）

---

## 4. 文件清单

```
d:/新CRM/
├── light-theme.css         ← 唯一样式覆盖文件（≈ 460 行）
├── dashboard.html          ← 注入 link / FX widget HTML+JS / 改 chart 色字面量
├── doc-maker.html          ← 仅注入 link
├── email.html              ← 仅注入 link
├── index.html              ← 仅注入 link（登录页）
├── login.html              ← 仅注入 link
├── logistics.html          ← 仅注入 link
└── password-vault.html     ← 仅注入 link
```

---

## 5. 关键 commit 历史（最近 → 最早）

| Hash | 说明 |
|---|---|
| `56cec2a` | brand 隐藏 T 图标 + 加粗、文件/工具加圆点、FX 字号加大加粗 |
| `536bf7c` | **整体切换到 premium dark-green 主题** |
| `bbeda1a` | KPI/charts/avatar 统一森林绿 + 登录 brand 水印 |
| `ef865c2` | nav-icon 改空心圆+绿点 / 加 USD→CNY 汇率徽章 |
| `3a4e981` | 切换到薄荷绿浅色调色板（已被 dark 覆盖） |
| `725b945` | 修补深色残留：AI 气泡/快速导出/邮件文件夹/铃铛 |
| `2b8076a` | 字体统一为微软雅黑 Light |
| `30f6880` | **初次切换到白底黑字 + 椭圆按钮** |

---

## 6. 已知未做 / 可能下一步

- [ ] 状态徽章需要按真实业务语义校色（pending/paid/shipped/cancel 等）—— 当前是通用 .badge/.tag 统一 emerald
- [ ] doc-maker / logistics / password-vault 三个页面**未截图验证**，可能存在残留硬编码深蓝色没被覆盖到（如有就告诉我具体元素）
- [ ] 邮件正文区（TinyMCE 编辑器内部 iframe）样式没改，会保持原 TinyMCE 默认 —— TinyMCE iframe 的 CSS 需要通过 `content_css` 配置注入，属于代码级改动
- [ ] 登录页指纹的脉冲动画 `@keyframes fp-pulse` 没动，颜色已 OK
- [ ] CRM 没有 `dark mode toggle` 切换器；如需做，可以在 `light-theme.css` 顶部加 `[data-theme="light"] :root{...}` 反转

---

## 7. 下次接续工作的指引

1. **打开任何一个 HTML 改动确认部署**
   ```
   git -C d:/新CRM log --oneline -10
   ```
2. **改 UI**：基本只改 [light-theme.css](./light-theme.css)。色板的 6 个变量集中在文件顶部 `:root{}` 块 —— 改这里能影响绝大部分元素；个别页面专用颜色（AI 气泡、quick-export 等）在文件下半部分按区块组织。
3. **改 logo 文字 / 水印**：搜 `TPKELE` 即可定位。
4. **改图表色**：只能动 `dashboard.html` 内的 Chart.js literal，搜 `borderColor:'#10B981'` 等。
5. **加新页面**：在新 HTML 的 `</head>` 前加一行 `<link rel="stylesheet" href="light-theme.css">` 即可继承全套主题。
6. **部署**：`git push origin main` → Vercel 30–90 秒自动构建 → 用户 `Ctrl+F5` 强刷。
7. **GitHub remote URL 安全提醒**：`origin` 中嵌入了一个明文 PAT，建议某次空闲时 `git remote set-url origin https://github.com/jacky-tpkele/crm-backend.git` 移除，改用凭据管理器或 SSH。

---

## 8. 用户偏好备忘

- 中文沟通，回答尽量简洁
- 改动后期望直接 `git commit` + `git push`，不需要每次确认
- 强调"不动逻辑、只改 UI 风格"
- 喜欢用截图圈红框 + 文字说明指出问题位置
