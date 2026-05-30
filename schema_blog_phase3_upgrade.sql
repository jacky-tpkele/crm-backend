-- =============================================
-- BLOG 自动化系统 - 第 3 阶段数据库升级
-- =============================================

-- 1. 升级 blog_posts 表（添加 SEO 字段和图片管理）
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS meta_title TEXT,
ADD COLUMN IF NOT EXISTS meta_description TEXT,
ADD COLUMN IF NOT EXISTS slug_url TEXT,
ADD COLUMN IF NOT EXISTS main_keyword TEXT,
ADD COLUMN IF NOT EXISTS sub_keywords TEXT[],
ADD COLUMN IF NOT EXISTS internal_links JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS external_links JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS faq JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
ADD COLUMN IF NOT EXISTS cover_image_cloudinary_id TEXT,
ADD COLUMN IF NOT EXISTS cover_image_alt TEXT,
ADD COLUMN IF NOT EXISTS content_images JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS word_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS reading_time INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 2. 索引优化
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug_url ON blog_posts(slug_url);
CREATE INDEX IF NOT EXISTS idx_blog_posts_main_keyword ON blog_posts(main_keyword);
