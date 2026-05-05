-- =============================================
-- XHON CRM 鈥?瀹屾暣鏁版嵁搴撶粨鏋?-- 浣跨敤鏂规硶锛氬叏閫夋墍鏈夊唴瀹?鈫?绮樿创鍒?Supabase SQL Editor 鈫?鐐瑰嚮 Run
-- =============================================

-- 鍚敤 UUID 鎵╁睍
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 瀹㈡埛琛?CREATE TABLE IF NOT EXISTS customers (
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

-- 浜у搧琛?CREATE TABLE IF NOT EXISTS products (
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

-- 渚涘簲鍟嗚〃
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

-- 浜у搧渚涘簲鍟嗗叧鑱旇〃
CREATE TABLE IF NOT EXISTS product_suppliers (
  product_id       UUID REFERENCES products(id)  ON DELETE CASCADE,
  supplier_id      UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  default_supplier BOOLEAN DEFAULT FALSE,
  purchase_price   NUMERIC(12,2) DEFAULT 0,
  lead_time        TEXT,
  PRIMARY KEY (product_id, supplier_id)
);

-- 璇㈢洏琛?CREATE TABLE IF NOT EXISTS inquiries (
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

-- 璁㈠崟琛?CREATE TABLE IF NOT EXISTS orders (
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

-- 璁㈠崟鏄庣粏琛?CREATE TABLE IF NOT EXISTS order_items (
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

-- 鏂囨。琛?CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID REFERENCES orders(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  language      TEXT DEFAULT 'en',
  file_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 鏂囨。妯℃澘琛?CREATE TABLE IF NOT EXISTS document_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name    TEXT NOT NULL,
  document_type    TEXT NOT NULL,
  template_content TEXT,
  version          INTEGER DEFAULT 1
);

-- 鏂囨。瀵煎嚭璁板綍琛?CREATE TABLE IF NOT EXISTS document_exports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID REFERENCES documents(id) ON DELETE CASCADE,
  export_format TEXT NOT NULL,
  exported_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- 閭欢琛紙Email Module锛?-- =============================================
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
-- AI 鍔╂墜璁剧疆琛?-- =============================================
CREATE TABLE IF NOT EXISTS ai_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL DEFAULT 'openai',
  api_key       TEXT,
  model         TEXT DEFAULT 'gpt-4o',
  system_prompt TEXT DEFAULT '浣犳槸涓€涓笓涓氱殑澶栬锤AI鍔╂墜锛屽府鍔╃敤鎴峰鐞嗗璐哥浉鍏冲伐浣滐紝鍖呮嫭閭欢鎾板啓銆佹姤浠峰垎鏋愩€佸鎴锋矡閫氱瓥鐣ョ瓑銆傝鐢ㄤ腑鏂囧洖澶嶃€?,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);


-- =============================================
-- Password Vault
-- =============================================
CREATE TABLE IF NOT EXISTS password_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username           TEXT NOT NULL,
  name               TEXT NOT NULL,
  platform           TEXT,
  account            TEXT NOT NULL,
  password_encrypted TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_items_user_created ON password_items(username, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_security (
  username         TEXT PRIMARY KEY,
  second_pass_hash TEXT NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
