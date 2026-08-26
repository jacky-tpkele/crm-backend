-- BLOG 自动化系统 - 第 9 阶段：产品化关键词库

ALTER TABLE blog_keywords
ADD COLUMN IF NOT EXISTS product_family TEXT DEFAULT 'mcb',
ADD COLUMN IF NOT EXISTS subfamily TEXT,
ADD COLUMN IF NOT EXISTS search_intent TEXT,
ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'GLOBAL',
ADD COLUMN IF NOT EXISTS search_volume INT,
ADD COLUMN IF NOT EXISTS metric_source TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS metric_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS parent_keyword TEXT;

CREATE INDEX IF NOT EXISTS idx_blog_keywords_product_family ON blog_keywords(product_family);
CREATE INDEX IF NOT EXISTS idx_blog_keywords_subfamily ON blog_keywords(subfamily);
CREATE INDEX IF NOT EXISTS idx_blog_keywords_country ON blog_keywords(country);
CREATE INDEX IF NOT EXISTS idx_blog_keywords_search_intent ON blog_keywords(search_intent);

COMMENT ON COLUMN blog_keywords.search_volume IS '真实外部数据；AI 扩充时必须为 NULL';
COMMENT ON COLUMN blog_keywords.metric_source IS 'manual/import/google_ads/search_console/other；不得标记 AI 推测值为 Google 数据';
