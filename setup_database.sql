-- =============================================
-- XHON CRM — 完整数据库结构
-- 使用方法：全选所有内容 → 粘贴到 Supabase SQL Editor → 点击 Run
-- =============================================

-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 客户表
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

-- 产品表
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

-- 供应商表
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

-- 产品供应商关联表
CREATE TABLE IF NOT EXISTS product_suppliers (
  product_id       UUID REFERENCES products(id)  ON DELETE CASCADE,
  supplier_id      UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  default_supplier BOOLEAN DEFAULT FALSE,
  purchase_price   NUMERIC(12,2) DEFAULT 0,
  lead_time        TEXT,
  PRIMARY KEY (product_id, supplier_id)
);

-- 询盘表
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

-- 订单表
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

-- 订单明细表
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

-- 文档表
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES orders(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  language      TEXT DEFAULT 'en',
  file_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 文档模板表
CREATE TABLE IF NOT EXISTS document_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name    TEXT NOT NULL,
  document_type    TEXT NOT NULL,
  template_content TEXT,
  version          INTEGER DEFAULT 1
);

-- 文档导出记录表
CREATE TABLE IF NOT EXISTS document_exports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
  export_format TEXT NOT NULL,
  exported_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 邮件表（Email Module）
-- =============================================
CREATE TABLE IF NOT EXISTS emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   TEXT UNIQUE,
  folder       TEXT NOT NULL DEFAULT 'INBOX',
  uid          BIGINT,
  from_address TEXT,
  from_name    TEXT,
  to_addresses TEXT,
  cc           TEXT,
  subject      TEXT,
  body_text    TEXT,
  body_html    TEXT,
  is_read      BOOLEAN DEFAULT false,
  is_deleted   BOOLEAN DEFAULT false,
  received_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_folder    ON emails(folder);
CREATE INDEX IF NOT EXISTS idx_emails_is_read   ON emails(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_received  ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_deleted   ON emails(is_deleted);

-- =============================================
-- AI 助手设置表
-- =============================================
CREATE TABLE IF NOT EXISTS ai_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL DEFAULT 'openai',
  api_key       TEXT,
  model         TEXT DEFAULT 'gpt-4o',
  system_prompt TEXT DEFAULT '你是一个专业的外贸AI助手，帮助用户处理外贸相关工作，包括邮件撰写、报价分析、客户沟通策略等。请用中文回复。',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
