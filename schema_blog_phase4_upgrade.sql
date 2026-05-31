-- =============================================
-- BLOG 自动化系统 - 第 4 阶段升级（审核工作台）
-- =============================================

-- 1. blog_posts 补 OG 图字段（SEO 社交分享卡专用）
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS og_image_url TEXT,
ADD COLUMN IF NOT EXISTS og_image_cloudinary_id TEXT;

-- 2. content_images 已经存在（JSONB），用于存正文插图记录
--    每条记录形如：
--    { id, url, cloudinaryId, altText, width, height, sectionIndex, suggestion }
