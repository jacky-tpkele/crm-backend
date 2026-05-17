-- ════════════════════════════════════════════════════════════
-- v2.9: 亚马逊运营升级
--   1. 自定义类目（直流/交流/...，可后期增加）
--   2. 产品毛利计算
--   3. 竞品品牌分组 + 规格(安培数/自定义)
--   4. 竞品关键词调研（多品牌横向对比）
--   5. SP-API 凭证存储
--   6. 全局运营配置（汇率/扣点/头程单价）
-- ════════════════════════════════════════════════════════════

-- ── 1. 自定义类目（产品类型，比如 直流/交流/漏保） ──
CREATE TABLE IF NOT EXISTS amazon_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT UNIQUE NOT NULL,        -- dc, ac, ...
  name_cn     TEXT NOT NULL,
  name_en     TEXT,
  sort_order  INT  DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- 默认两个类目
INSERT INTO amazon_categories (code, name_cn, name_en, sort_order) VALUES
  ('dc', '直流', 'DC', 1),
  ('ac', '交流', 'AC', 2)
ON CONFLICT (code) DO NOTHING;

-- ── 2. 全局运营配置（一处改全表算）──
CREATE TABLE IF NOT EXISTS amazon_op_config (
  id              INT PRIMARY KEY DEFAULT 1,
  exchange_rate   NUMERIC(6,3) DEFAULT 7.20,     -- 默认汇率 USD→RMB
  commission_rate NUMERIC(5,2) DEFAULT 15.00,    -- 默认 Amazon 扣点 %
  freight_per_kg  NUMERIC(8,2) DEFAULT 7.50,     -- 默认头程 ￥/kg
  sp_api_client_id      TEXT,
  sp_api_client_secret  TEXT,                    -- 已加密
  sp_api_refresh_token  TEXT,                    -- 已加密
  sp_api_seller_id      TEXT,
  sp_api_marketplace_id TEXT DEFAULT 'ATVPDKIKX0DER',  -- 默认美国站
  sp_api_last_sync      TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT op_config_singleton CHECK (id = 1)
);
INSERT INTO amazon_op_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── 3. 产品毛利计算（自家产品）──
CREATE TABLE IF NOT EXISTS amazon_margin_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code   TEXT NOT NULL DEFAULT 'dc',
  sort_order      INT  DEFAULT 0,
  image_url       TEXT,
  spec            TEXT,                            -- 参数/规格，例如「直流10A」
  amperage        TEXT,                            -- 安培数，例如「10A」（可与spec独立用作筛选）
  asin            TEXT,
  sku             TEXT,                            -- 关联自家SKU
  purchase_price  NUMERIC(10,2) DEFAULT 0,         -- 进货价 RMB
  sale_price_usd  NUMERIC(10,2) DEFAULT 0,         -- 销售价 USD
  exchange_rate   NUMERIC(6,3),                    -- 留空=用全局
  commission_rate NUMERIC(5,2),                    -- 留空=用全局
  fba_fee_usd     NUMERIC(10,2) DEFAULT 0,
  weight_lb       NUMERIC(8,2) DEFAULT 0,
  freight_per_kg  NUMERIC(8,2),                    -- 留空=用全局
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_margin_cat ON amazon_margin_items(category_code) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_margin_asin ON amazon_margin_items(asin) WHERE is_active = TRUE;

-- ── 4. 竞品品牌分组 ──
CREATE TABLE IF NOT EXISTS amazon_competitor_brands (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name    TEXT NOT NULL,
  category_code TEXT,                              -- 所属类目
  logo_url      TEXT,
  notes         TEXT,
  sort_order    INT DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brand_cat ON amazon_competitor_brands(category_code) WHERE is_active = TRUE;

-- ── 5. 升级 amazon_competitors：加 brand_id, amperage, monthly_sales ──
ALTER TABLE amazon_competitors ADD COLUMN IF NOT EXISTS brand_id      UUID REFERENCES amazon_competitor_brands(id) ON DELETE SET NULL;
ALTER TABLE amazon_competitors ADD COLUMN IF NOT EXISTS category_code TEXT;
ALTER TABLE amazon_competitors ADD COLUMN IF NOT EXISTS amperage      TEXT;     -- 10A/16A/20A...
ALTER TABLE amazon_competitors ADD COLUMN IF NOT EXISTS monthly_sales TEXT;     -- "<50" / "100+" / "300+" 区间文本
ALTER TABLE amazon_competitors ADD COLUMN IF NOT EXISTS monthly_sales_num INT;  -- 排序用数值

-- ── 6. 竞品关键词调研（多品牌横向）──
CREATE TABLE IF NOT EXISTS amazon_brand_keywords (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            UUID REFERENCES amazon_competitor_brands(id) ON DELETE CASCADE,
  keyword             TEXT NOT NULL,
  organic_rank        INT,
  organic_traffic_pct NUMERIC(5,2),    -- 自然流量占比 %
  ad_traffic_pct      NUMERIC(5,2),    -- 广告流量占比 %
  snapshot_date       DATE DEFAULT CURRENT_DATE,
  sort_order          INT DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bkw_brand ON amazon_brand_keywords(brand_id);
CREATE INDEX IF NOT EXISTS idx_bkw_keyword ON amazon_brand_keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_bkw_date ON amazon_brand_keywords(snapshot_date);

-- ── 7. 升级现有 amazon_competitors / amazon_keywords / amazon_sku_config 加类目 ──
ALTER TABLE amazon_keywords        ADD COLUMN IF NOT EXISTS category_code TEXT;
ALTER TABLE amazon_sku_config      ADD COLUMN IF NOT EXISTS category_code TEXT;
