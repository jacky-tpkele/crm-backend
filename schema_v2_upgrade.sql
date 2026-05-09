-- =============================================
-- TPKELE CRM v2 — 供应商/产品/订单 模块重建
-- 在 Supabase SQL Editor 执行（一次性）
-- 注意：会删除 suppliers/products/orders/order_items/product_suppliers 现有数据
-- 其他表（customers/emails/ai/password 等）不受影响
-- =============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 删除旧表（按外键依赖反序） ──
DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders      CASCADE;
DROP TABLE IF EXISTS price_history        CASCADE;
DROP TABLE IF EXISTS supplier_contacts    CASCADE;
DROP TABLE IF EXISTS order_items          CASCADE;
DROP TABLE IF EXISTS orders               CASCADE;
DROP TABLE IF EXISTS product_suppliers    CASCADE;
DROP TABLE IF EXISTS products             CASCADE;
DROP TABLE IF EXISTS suppliers            CASCADE;

-- ═══════════════════════════════════════════════
-- 1. 供应商主表
-- ═══════════════════════════════════════════════
CREATE TABLE suppliers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code   TEXT,                                 -- 供应商编号（SUP-001）
  supplier_name   TEXT NOT NULL,
  contact_name    TEXT,                                 -- 主联系人（兼容旧字段）
  phone           TEXT,                                 -- 主电话（兼容旧字段）
  email           TEXT,                                 -- 主邮箱（兼容旧字段）
  address         TEXT,                                 -- 地址
  payment_terms   TEXT,                                 -- 付款条件（30%定金等）
  rating          INTEGER DEFAULT 0,                    -- 评级 0-5
  status          TEXT DEFAULT 'active',                -- active / paused / dropped
  notes           TEXT,
  product_image_data TEXT,                              -- 兼容旧的产品图字段
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_suppliers_name ON suppliers(supplier_name) WHERE is_deleted = FALSE;
CREATE INDEX idx_suppliers_code ON suppliers(supplier_code) WHERE is_deleted = FALSE;

-- ═══════════════════════════════════════════════
-- 2. 供应商联系方式（多条）
-- ═══════════════════════════════════════════════
CREATE TABLE supplier_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  channel_type  TEXT NOT NULL,                          -- wechat / phone / taobao / 1688 / email / qq / other
  value         TEXT NOT NULL,                          -- 账号/号码/链接
  contact_name  TEXT,                                   -- 联系人姓名
  is_primary    BOOLEAN DEFAULT FALSE,
  remarks       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_supcontacts_supplier ON supplier_contacts(supplier_id);

-- ═══════════════════════════════════════════════
-- 3. 产品主表
-- ═══════════════════════════════════════════════
CREATE TABLE products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code           TEXT,                          -- 产品编号
  product_name_cn        TEXT NOT NULL,
  product_name_en        TEXT,
  specification          TEXT,
  unit                   TEXT DEFAULT 'pcs',
  hs_code                TEXT,
  certification          TEXT,
  category               TEXT,
  image_url              TEXT,
  default_supplier_id    UUID REFERENCES suppliers(id) ON DELETE SET NULL,  -- 默认供应商
  default_purchase_price NUMERIC(12,2) DEFAULT 0,       -- 默认采购价（USD or RMB，看 currency）
  default_sales_price    NUMERIC(12,2) DEFAULT 0,       -- 默认销售价
  default_lead_time      TEXT,                          -- 默认交期
  last_purchase_price    NUMERIC(12,2),                 -- 最近一次采购价
  last_purchase_date     DATE,
  last_sales_price       NUMERIC(12,2),                 -- 最近一次销售价
  last_sales_date        DATE,
  is_deleted             BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_products_code ON products(product_code)      WHERE is_deleted = FALSE;
CREATE INDEX idx_products_name ON products(product_name_cn)   WHERE is_deleted = FALSE;
CREATE INDEX idx_products_def_sup ON products(default_supplier_id);

-- ═══════════════════════════════════════════════
-- 4. 产品-供应商 多对多
-- ═══════════════════════════════════════════════
CREATE TABLE product_suppliers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  supplier_id           UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_product_code TEXT,                           -- 供应商那边的型号
  purchase_price        NUMERIC(12,2) DEFAULT 0,
  currency              TEXT DEFAULT 'RMB',             -- RMB / USD
  moq                   NUMERIC(12,2),                  -- 起订量
  lead_time             TEXT,
  priority              INTEGER DEFAULT 2,              -- 1=默认 2=备用 3=应急
  remarks               TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, supplier_id)
);
CREATE INDEX idx_ps_product  ON product_suppliers(product_id);
CREATE INDEX idx_ps_supplier ON product_suppliers(supplier_id);

-- ═══════════════════════════════════════════════
-- 5. 价格历史（每次订单保存自动记录）
-- ═══════════════════════════════════════════════
CREATE TABLE price_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID REFERENCES products(id)  ON DELETE CASCADE,
  supplier_id  UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  price_type   TEXT NOT NULL,                            -- purchase / sales
  price        NUMERIC(12,2) NOT NULL,
  currency     TEXT DEFAULT 'USD',
  quantity     NUMERIC(12,2),
  order_id     UUID,                                     -- 关联订单（可空）
  customer_id  UUID,                                     -- 关联客户（销售时记录）
  recorded_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ph_product   ON price_history(product_id);
CREATE INDEX idx_ph_supplier  ON price_history(supplier_id);
CREATE INDEX idx_ph_recorded  ON price_history(recorded_at DESC);

-- ═══════════════════════════════════════════════
-- 6. 订单主表
-- ═══════════════════════════════════════════════
CREATE TABLE orders (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number           TEXT,                            -- 订单号（自动生成）
  customer_id            UUID REFERENCES customers(id),
  customer_name          TEXT,
  order_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  shipping_fee           NUMERIC(12,2) DEFAULT 0,
  purchase_total         NUMERIC(12,2) DEFAULT 0,         -- 采购总额（RMB）
  sales_total            NUMERIC(12,2) DEFAULT 0,         -- 销售总额含运费
  sales_without_shipping NUMERIC(12,2) DEFAULT 0,         -- 销售额不含运费
  profit                 NUMERIC(12,2) DEFAULT 0,         -- 毛利润（按订单币种）
  profit_rmb             NUMERIC(12,2) DEFAULT 0,         -- 毛利润折算 RMB
  profit_rate            NUMERIC(6,2)  DEFAULT 0,         -- 利润率 %
  currency               TEXT DEFAULT 'USD',              -- 销售币种
  exchange_rate          NUMERIC(10,4) DEFAULT 7.20,      -- 当时美元对 RMB 汇率
  order_status           TEXT DEFAULT 'confirmed',
  remarks                TEXT,
  is_deleted             BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_orders_date     ON orders(order_date)   WHERE is_deleted = FALSE;
CREATE INDEX idx_orders_customer ON orders(customer_id)  WHERE is_deleted = FALSE;
CREATE INDEX idx_orders_status   ON orders(order_status) WHERE is_deleted = FALSE;
CREATE INDEX idx_orders_number   ON orders(order_number) WHERE is_deleted = FALSE;

-- ═══════════════════════════════════════════════
-- 7. 订单明细（products + suppliers 都用外键，名称作快照）
-- ═══════════════════════════════════════════════
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id)    ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id)  ON DELETE SET NULL,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  product_name_cn TEXT,                                   -- 快照（防止产品改名后历史失真）
  product_name_en TEXT,
  specification   TEXT,
  unit            TEXT,
  quantity        NUMERIC(12,2) DEFAULT 1,
  purchase_price  NUMERIC(12,2) DEFAULT 0,                -- 采购单价 RMB
  sales_price     NUMERIC(12,2) DEFAULT 0,                -- 销售单价（订单币种）
  purchase_total  NUMERIC(12,2) DEFAULT 0,
  sales_total     NUMERIC(12,2) DEFAULT 0,
  item_remarks    TEXT,
  sort_order      INTEGER DEFAULT 0
);
CREATE INDEX idx_items_order_id ON order_items(order_id);
CREATE INDEX idx_items_product  ON order_items(product_id);
CREATE INDEX idx_items_supplier ON order_items(supplier_id);

-- ═══════════════════════════════════════════════
-- 8. 采购单（订单保存后按供应商自动拆分）
-- ═══════════════════════════════════════════════
CREATE TABLE purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number       TEXT,                                   -- PO-YYYYMMDD-001
  order_id        UUID REFERENCES orders(id)    ON DELETE CASCADE,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name   TEXT,                                   -- 快照
  po_date         DATE DEFAULT CURRENT_DATE,
  expected_date   DATE,                                   -- 预计到货
  actual_date     DATE,                                   -- 实际到货
  status          TEXT DEFAULT 'pending',                 -- pending / sent / confirmed / shipped / received
  total_amount    NUMERIC(12,2) DEFAULT 0,                -- 采购总额（RMB）
  currency        TEXT DEFAULT 'RMB',
  remarks         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_po_order    ON purchase_orders(order_id);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_po_status   ON purchase_orders(status);

CREATE TABLE purchase_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  order_item_id   UUID REFERENCES order_items(id) ON DELETE SET NULL,
  product_id      UUID REFERENCES products(id)    ON DELETE SET NULL,
  product_name_cn TEXT,
  specification   TEXT,
  unit            TEXT,
  quantity        NUMERIC(12,2) DEFAULT 1,
  purchase_price  NUMERIC(12,2) DEFAULT 0,
  subtotal        NUMERIC(12,2) DEFAULT 0,
  remarks         TEXT
);
CREATE INDEX idx_poi_po       ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_poi_product  ON purchase_order_items(product_id);

-- ═══════════════════════════════════════════════
-- 完成
-- ═══════════════════════════════════════════════
