-- =============================================
-- BLOG 自动化系统 - 第 1 阶段数据库升级
-- =============================================

-- 1. 升级 blog_posts 表（添加审核流程和状态管理）
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft',
ADD COLUMN IF NOT EXISTS article_type TEXT,
ADD COLUMN IF NOT EXISTS review_notes TEXT,
ADD COLUMN IF NOT EXISTS seo_score INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'not_synced',
ADD COLUMN IF NOT EXISTS sync_error TEXT,
ADD COLUMN IF NOT EXISTS generation_error TEXT;

-- 2. 升级 blog_keywords 表（添加分类、难度、优先级）
ALTER TABLE blog_keywords
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS difficulty INT DEFAULT 3,
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';

-- 3. 升级 blog_config 表（添加生成配置）
ALTER TABLE blog_config
ADD COLUMN IF NOT EXISTS daily_generation_count INT DEFAULT 4,
ADD COLUMN IF NOT EXISTS article_type_ratio JSONB DEFAULT '{"product": 40, "comparison": 25, "application": 20, "buying": 10, "faq": 5}',
ADD COLUMN IF NOT EXISTS last_generation_error TEXT;

-- 4. 创建 blog_generation_log 表（记录每次生成的详细信息）
CREATE TABLE IF NOT EXISTS blog_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_time TIMESTAMPTZ DEFAULT NOW(),
  trigger_type TEXT,  -- 'auto' 或 'manual'
  total_count INT,
  success_count INT,
  failure_count INT,
  error_message TEXT,
  details JSONB,  -- 存储详细的生成结果
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_sync_status ON blog_posts(sync_status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_article_type ON blog_posts(article_type);
CREATE INDEX IF NOT EXISTS idx_blog_keywords_category ON blog_keywords(category);
CREATE INDEX IF NOT EXISTS idx_blog_generation_log_time ON blog_generation_log(generation_time DESC);

-- 6. 初始化 blog_config 的新字段
INSERT INTO blog_config (config_key, config_value, daily_generation_count, article_type_ratio)
VALUES
  ('daily_generation_count', '4', 4, '{"product": 40, "comparison": 25, "application": 20, "buying": 10, "faq": 5}')
ON CONFLICT (config_key) DO UPDATE SET
  daily_generation_count = EXCLUDED.daily_generation_count,
  article_type_ratio = EXCLUDED.article_type_ratio;
