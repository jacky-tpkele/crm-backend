-- ════════════════════════════════════════════════════════════
-- v2.6: 亚马逊库存智能补货系统
-- 存储 SKU 配置 + 每日销量快照（用于预测算法）
-- ════════════════════════════════════════════════════════════

-- SKU 配置表（每个产品的补货参数）
CREATE TABLE IF NOT EXISTS amazon_sku_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT NOT NULL,
  asin            TEXT,
  product_name    TEXT NOT NULL,
  image_url       TEXT,
  -- 前置时间参数（天）
  production_days INT DEFAULT 7,
  domestic_days   INT DEFAULT 3,
  shipping_days   INT DEFAULT 25,
  fba_intake_days INT DEFAULT 5,
  -- 补货策略
  coverage_days   INT DEFAULT 60,
  service_level   NUMERIC(4,2) DEFAULT 95,
  moq             INT DEFAULT 1,
  -- 季节性（JSON: {"10":1.3, "11":1.5, "12":1.5}）
  seasonality     JSONB DEFAULT '{}',
  -- 当前库存（手动或 API 同步）
  fba_stock       INT DEFAULT 0,
  inbound_stock   INT DEFAULT 0,
  -- 运输方式偏好
  ship_method     TEXT DEFAULT 'sea',
  air_days        INT DEFAULT 7,
  -- 状态
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sku_config_sku ON amazon_sku_config(sku) WHERE is_active = TRUE;

-- 每日销量快照（用于趋势/波动计算）
CREATE TABLE IF NOT EXISTS amazon_daily_sales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         TEXT NOT NULL,
  sale_date   DATE NOT NULL,
  units_sold  INT DEFAULT 0,
  revenue     NUMERIC(10,2) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_sales_sku_date ON amazon_daily_sales(sku, sale_date);
CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON amazon_daily_sales(sale_date);
