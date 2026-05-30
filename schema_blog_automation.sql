-- =============================================
-- BLOG 自动化系统 - 完整数据库结构
-- =============================================

-- 1. BLOG 计划表
CREATE TABLE IF NOT EXISTS blog_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_month TEXT NOT NULL,           -- "2026-06" 标识 30 天计划
  plan_order INT NOT NULL,            -- 第几篇（1-120）
  keyword TEXT NOT NULL,              -- 关键词
  title TEXT,                         -- BLOG 标题
  status TEXT DEFAULT 'pending',      -- pending/content_generated/published
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(plan_month, plan_order)
);

CREATE INDEX IF NOT EXISTS idx_blog_plans_month ON blog_plans(plan_month);
CREATE INDEX IF NOT EXISTS idx_blog_plans_status ON blog_plans(status);
CREATE INDEX IF NOT EXISTS idx_blog_plans_keyword ON blog_plans(keyword);

-- 2. BLOG 文章表
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES blog_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,              -- Markdown 格式
  image_url TEXT,                     -- Cloudinary CDN URL
  image_cloudinary_id TEXT,           -- 便于删除/更新
  image_original_size INT,            -- 原始大小（字节）
  image_compressed_size INT,          -- 压缩后大小（字节）
  image_width INT,                    -- 图片宽度
  image_height INT,                   -- 图片高度
  keywords TEXT[],                    -- 关键词数组
  slug TEXT UNIQUE,                   -- URL slug
  status TEXT DEFAULT 'draft',        -- draft/published
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published_at);
CREATE INDEX IF NOT EXISTS idx_blog_posts_plan_id ON blog_posts(plan_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);

-- 3. 关键词库
CREATE TABLE IF NOT EXISTS blog_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT UNIQUE NOT NULL,
  used_count INT DEFAULT 0,           -- 已使用次数
  last_used_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_keywords_keyword ON blog_keywords(keyword);

-- 4. BLOG 配置表
CREATE TABLE IF NOT EXISTS blog_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始化配置
INSERT INTO blog_config (config_key, config_value)
VALUES ('current_plan_month', '2026-06')
ON CONFLICT (config_key) DO NOTHING;

-- =============================================
-- 权限设置（RLS - Row Level Security）
-- =============================================

-- 启用 RLS
ALTER TABLE blog_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_config ENABLE ROW LEVEL SECURITY;

-- blog_plans 策略
CREATE POLICY "Allow authenticated users to read blog_plans"
  ON blog_plans FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert blog_plans"
  ON blog_plans FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update blog_plans"
  ON blog_plans FOR UPDATE
  USING (auth.role() = 'authenticated');

-- blog_posts 策略
CREATE POLICY "Allow authenticated users to read blog_posts"
  ON blog_posts FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert blog_posts"
  ON blog_posts FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update blog_posts"
  ON blog_posts FOR UPDATE
  USING (auth.role() = 'authenticated');

-- blog_keywords 策略
CREATE POLICY "Allow authenticated users to read blog_keywords"
  ON blog_keywords FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert blog_keywords"
  ON blog_keywords FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update blog_keywords"
  ON blog_keywords FOR UPDATE
  USING (auth.role() = 'authenticated');

-- blog_config 策略
CREATE POLICY "Allow authenticated users to read blog_config"
  ON blog_config FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update blog_config"
  ON blog_config FOR UPDATE
  USING (auth.role() = 'authenticated');
