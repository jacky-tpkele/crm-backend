-- ════════════════════════════════════════════════════════════
-- v2.10: 补 logistics 表 DDL（之前只在线上 schema 里，仓库无定义）
--
-- 历史：v2.2 / v2.3 通过 ALTER 给 logistics 加了 shipment_items / created_by，
-- 但 CREATE TABLE 一直没在仓库 SQL 文件里，新环境部署会缺失。
-- 这里补齐建表 + 之前的所有 ALTER 增量。重复执行安全（IF NOT EXISTS）。
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS logistics (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_name         TEXT,
  tracking_number    TEXT,
  carrier            TEXT,
  weight             NUMERIC(10,2),
  volume             NUMERIC(10,3),
  shipping_date      DATE,
  estimated_arrival  DATE,
  notes              TEXT,
  shipment_items     JSONB DEFAULT '[]'::jsonb,
  created_by         UUID,
  is_deleted         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_order ON logistics(order_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_logistics_tracking ON logistics(tracking_number);
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_items ON logistics USING GIN (shipment_items);
