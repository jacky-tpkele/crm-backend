-- ════════════════════════════════════════════════════════════
-- v2.7: Amazon 广告管理 + 竞对调研
-- ════════════════════════════════════════════════════════════

-- ── 广告：Campaign 级别每日数据 ──
CREATE TABLE IF NOT EXISTS amazon_ad_daily (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name TEXT NOT NULL,
  ad_group      TEXT,
  keyword       TEXT,
  match_type    TEXT DEFAULT 'broad',
  ad_date       DATE NOT NULL,
  impressions   INT DEFAULT 0,
  clicks        INT DEFAULT 0,
  spend         NUMERIC(10,2) DEFAULT 0,
  sales         NUMERIC(10,2) DEFAULT 0,
  orders        INT DEFAULT 0,
  acos          NUMERIC(6,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_daily_date ON amazon_ad_daily(ad_date);
CREATE INDEX IF NOT EXISTS idx_ad_daily_kw ON amazon_ad_daily(keyword);

-- ── 广告：自动调价规则 ──
CREATE TABLE IF NOT EXISTS amazon_ad_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name     TEXT NOT NULL,
  -- 条件
  metric        TEXT NOT NULL DEFAULT 'acos',
  operator      TEXT NOT NULL DEFAULT '>',
  threshold     NUMERIC(10,2) NOT NULL DEFAULT 35,
  days          INT DEFAULT 3,
  min_clicks    INT DEFAULT 10,
  -- 动作
  action_type   TEXT NOT NULL DEFAULT 'decrease_bid',
  action_value  NUMERIC(6,2) DEFAULT 15,
  -- 状态
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 广告：否定关键词 ──
CREATE TABLE IF NOT EXISTS amazon_negative_keywords (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword       TEXT NOT NULL,
  campaign_name TEXT,
  reason        TEXT,
  total_spend   NUMERIC(10,2) DEFAULT 0,
  total_clicks  INT DEFAULT 0,
  total_orders  INT DEFAULT 0,
  added_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_neg_kw ON amazon_negative_keywords(keyword);

-- ── 竞对：追踪的 ASIN ──
CREATE TABLE IF NOT EXISTS amazon_competitors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin          TEXT NOT NULL,
  title         TEXT,
  brand         TEXT,
  image_url     TEXT,
  price         NUMERIC(10,2),
  bsr           INT,
  reviews       INT,
  rating        NUMERIC(3,1),
  category      TEXT,
  notes         TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comp_asin ON amazon_competitors(asin) WHERE is_active = TRUE;

-- ── 竞对：关键词库 ──
CREATE TABLE IF NOT EXISTS amazon_keywords (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword       TEXT NOT NULL,
  source        TEXT DEFAULT 'manual',
  search_volume INT,
  competition   TEXT,
  suggested_bid NUMERIC(6,2),
  our_rank      INT,
  competitor_asin TEXT,
  notes         TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_keywords_kw ON amazon_keywords(keyword) WHERE is_active = TRUE;

-- ── 竞对：价格/BSR 历史快照 ──
CREATE TABLE IF NOT EXISTS amazon_competitor_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asin          TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  price         NUMERIC(10,2),
  bsr           INT,
  reviews       INT,
  rating        NUMERIC(3,1),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comp_hist ON amazon_competitor_history(asin, snapshot_date);
