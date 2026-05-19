# XHON CRM — 部署配置说明

## 一、环境变量配置（Vercel 后台设置）

在 Vercel 项目后台 → Settings → Environment Variables 中添加以下变量：

```
NEXT_PUBLIC_SUPABASE_URL=https://你的项目ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的anon公钥
JWT_SECRET=随机字符串（至少32位，例如：xhon-crm-jwt-secret-2025）
CRM_USERNAME=TPKELE
CRM_PASSWORD=662255
```

---

## 二、Supabase 数据库建表

登录 [supabase.com](https://supabase.com)，进入你的项目后：  
**左侧菜单 → SQL Editor → New Query**，将以下 SQL 全部粘贴进去执行：

```sql
-- =============================================
-- XHON CRM — 完整数据库结构
-- =============================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------
-- 客户表 customers
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name    TEXT NOT NULL,
  country          TEXT,
  email            TEXT,
  whatsapp         TEXT,
  payment_terms    TEXT,
  shipping_address TEXT,
  customer_level   TEXT DEFAULT 'standard',
  notes            TEXT,
  is_deleted       BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name    ON customers(customer_name) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country)       WHERE is_deleted = FALSE;

-- -----------------------------------------------
-- 产品表 products
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code           TEXT,
  product_name_cn        TEXT NOT NULL,
  product_name_en        TEXT,
  specification          TEXT,
  unit                   TEXT DEFAULT 'pcs',
  default_purchase_price NUMERIC(12,2) DEFAULT 0,
  default_sales_price    NUMERIC(12,2) DEFAULT 0,
  hs_code                TEXT,
  certification          TEXT,
  is_deleted             BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_code ON products(product_code)    WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_products_name ON products(product_name_cn) WHERE is_deleted = FALSE;

-- -----------------------------------------------
-- 供应商表 suppliers
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name      TEXT NOT NULL,
  contact_name       TEXT,
  phone              TEXT,
  email              TEXT,
  product_link       TEXT,
  lead_time          TEXT,
  notes              TEXT,
  product_image_data TEXT,
  is_deleted         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(supplier_name) WHERE is_deleted = FALSE;

-- -----------------------------------------------
-- 产品供应商关联表 product_suppliers（多对多）
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS product_suppliers (
  product_id       UUID REFERENCES products(id)  ON DELETE CASCADE,
  supplier_id      UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  default_supplier BOOLEAN DEFAULT FALSE,
  purchase_price   NUMERIC(12,2) DEFAULT 0,
  lead_time        TEXT,
  PRIMARY KEY (product_id, supplier_id)
);

-- -----------------------------------------------
-- 询盘表 inquiries
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inquiries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id),
  customer_name TEXT,
  inquiry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  status        TEXT DEFAULT 'new',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status      ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_customer_id ON inquiries(customer_id);

-- -----------------------------------------------
-- 订单表 orders
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id            UUID REFERENCES customers(id),
  inquiry_id             UUID REFERENCES inquiries(id),
  customer_name          TEXT,
  order_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  shipping_fee           NUMERIC(12,2) DEFAULT 0,
  purchase_total         NUMERIC(12,2) DEFAULT 0,
  sales_total            NUMERIC(12,2) DEFAULT 0,
  sales_without_shipping NUMERIC(12,2) DEFAULT 0,
  profit                 NUMERIC(12,2) DEFAULT 0,
  currency               TEXT DEFAULT 'USD',
  order_status           TEXT DEFAULT 'confirmed',
  remarks                TEXT,
  is_deleted             BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_date     ON orders(order_date)   WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(order_status) WHERE is_deleted = FALSE;

-- -----------------------------------------------
-- 订单明细表 order_items
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id       UUID,
  supplier_id      UUID,
  product_name_cn  TEXT,
  product_name_en  TEXT,
  specification    TEXT,
  quantity         NUMERIC(12,2) DEFAULT 1,
  purchase_price   NUMERIC(12,2) DEFAULT 0,
  sales_price      NUMERIC(12,2) DEFAULT 0,
  purchase_total   NUMERIC(12,2) DEFAULT 0,
  sales_total      NUMERIC(12,2) DEFAULT 0,
  supplier_company TEXT,
  supplier_phone   TEXT,
  supplier_email   TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product  ON order_items(product_id);

-- -----------------------------------------------
-- 文档表 documents
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES orders(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  language      TEXT DEFAULT 'en',
  file_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------
-- 文档模板表 document_templates
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS document_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name    TEXT NOT NULL,
  document_type    TEXT NOT NULL,
  template_content TEXT,
  version          INTEGER DEFAULT 1
);

-- -----------------------------------------------
-- 文档导出记录表 document_exports
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS document_exports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
  export_format TEXT NOT NULL,
  exported_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 三、上传代码到 GitHub

1. 在 GitHub 新建一个仓库（Repository）
2. 将本地项目文件夹上传到仓库

---

## 四、部署到 Vercel

1. 登录 [vercel.com](https://vercel.com)，点击 **Add New Project**
2. 选择刚才的 GitHub 仓库导入
3. 不需要修改任何构建设置，直接点击 **Deploy**
4. 部署完成后，进入 **Settings → Environment Variables**，添加第一步中的所有环境变量
5. 添加完环境变量后，点击 **Redeploy**（重新部署）使变量生效

---

## 六、项目文件结构（2026-05-19 现状）

```
/
├── login.html          # 登录页（根路径 / 自动跳此页）
├── dashboard.html      # 主面板（订单/客户/产品/供应商/采购单/分析/系统设置 9 合 1）
├── logistics.html      # 物流单（独立页）
├── documents.html      # PI/Quotation/Packing List 生成 + 历史档案
├── email.html          # 邮件（IMAP/SMTP，URL 带 ?customer_id=xxx 看客户专属邮件）
├── password-vault.html # 密码保险柜
├── ai.html             # AI 助手（直连 SiliconFlow，与后端无关）
├── amazon-margin.html      # 产品毛利
├── amazon-inventory.html   # 库存智能补货
├── amazon-research.html    # 竞品调研（含品牌+关键词矩阵）
├── amazon-ads.html         # 广告管理
├── _shared/
│   ├── layout.css      # 公共主题 + 侧栏 + 按钮 + 表格 + 弹窗 + toast
│   ├── layout.js       # CRM.api / showToast / mountSidebar / 401 自动跳登录
│   └── i18n.js         # 统一 i18n 词典 + applyI18n + extendI18n
├── api/
│   └── index.js        # Express + Supabase REST，单文件后端
├── schema_v2_upgrade.sql           # 主结构（v2.0）
├── schema_v2_1_patch.sql ~ v2_12*  # 增量迁移（按顺序执行）
├── setup_database.sql              # 含历史 customers/orders/emails/...（首次部署用）
├── package.json
├── vercel.json
└── README_SETUP.md
```

**SQL 部署顺序**（首次新环境）：
1. `setup_database.sql` — 基础表（customers/orders/order_items/emails/documents/password_vault…）
2. `schema_v2_upgrade.sql` — v2 结构升级（products/suppliers/purchase_orders 重建）
3. 按文件名顺序执行 `schema_v2_1_patch.sql` 一直到最新的 `schema_v2_12_*.sql`

所有迁移文件用 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`，可重复执行，安全。

---

## 五、登录账号

| 用户名 | 密码 |
|--------|------|
| TPKELE | 662255 |

---

## 七、获取 Supabase 密钥

1. 登录 [supabase.com](https://supabase.com) → 进入你的项目
2. 左侧菜单 → **Project Settings → API**
3. 复制 **Project URL**（填入 `NEXT_PUBLIC_SUPABASE_URL`）
4. 复制 **anon public** 密钥（填入 `NEXT_PUBLIC_SUPABASE_ANON_KEY`）
