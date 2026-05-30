-- =============================================
-- BLOG 自动化系统 - 第 2 阶段数据库升级
-- =============================================

-- 1. 升级 blog_keywords 表（添加分类、难度、优先级）
ALTER TABLE blog_keywords
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'product',
ADD COLUMN IF NOT EXISTS difficulty INT DEFAULT 3,
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS ai_recommended BOOLEAN DEFAULT false;

-- 2. 升级 blog_plans 表（添加文章类型、每天篇数）
ALTER TABLE blog_plans
ADD COLUMN IF NOT EXISTS article_type TEXT DEFAULT 'product',
ADD COLUMN IF NOT EXISTS daily_count INT DEFAULT 4;

-- 3. 升级 blog_config 表（添加生成规划配置）
ALTER TABLE blog_config
ADD COLUMN IF NOT EXISTS daily_count INT DEFAULT 4,
ADD COLUMN IF NOT EXISTS type_ratio JSONB DEFAULT '{"product":40,"comparison":25,"application":20,"buying":10,"faq":5}',
ADD COLUMN IF NOT EXISTS title_template TEXT DEFAULT 'auto';

-- 4. 初始化配置
INSERT INTO blog_config (config_key, config_value)
VALUES ('plan_settings', '{"daily_count":4,"type_ratio":{"product":40,"comparison":25,"application":20,"buying":10,"faq":5},"title_template":"auto"}')
ON CONFLICT (config_key) DO NOTHING;

-- 5. 索引优化
CREATE INDEX IF NOT EXISTS idx_blog_keywords_category ON blog_keywords(category);
CREATE INDEX IF NOT EXISTS idx_blog_keywords_priority ON blog_keywords(priority);
CREATE INDEX IF NOT EXISTS idx_blog_plans_article_type ON blog_plans(article_type);
