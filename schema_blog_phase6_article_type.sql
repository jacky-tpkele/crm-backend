-- =============================================
-- BLOG 自动化系统 - 第 6 阶段升级（文章分类 + 同步）
-- =============================================
-- 目的：让 blog_posts 也带 article_type，与 blog_plans 字段对齐，
--       网站可以按分类展示。

-- 1. 给 blog_posts 加 article_type 字段（5 个值之一：product / comparison / application / buying / faq）
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS article_type TEXT;

-- 2. 把已有 post 的 article_type 从对应 plan 同步过来（一次性回填）
UPDATE blog_posts p
SET article_type = pl.article_type
FROM blog_plans pl
WHERE p.plan_id = pl.id
  AND p.article_type IS NULL
  AND pl.article_type IS NOT NULL;

-- 3. 索引（分类列表页要按 type 筛选 + status）
CREATE INDEX IF NOT EXISTS idx_blog_posts_article_type ON blog_posts(article_type);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_type ON blog_posts(status, article_type);

-- 4. 检查约束（可选，避免脏数据）
-- 已注释，如希望强约束可启用
-- ALTER TABLE blog_posts
-- ADD CONSTRAINT chk_blog_posts_article_type
-- CHECK (article_type IS NULL OR article_type IN ('product','comparison','application','buying','faq'));
