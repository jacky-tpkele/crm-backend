-- BLOG 自动化系统 - 第 11 阶段：产品项目贯穿文章工作流

ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS product_family TEXT,
ADD COLUMN IF NOT EXISTS product_subfamily TEXT;

ALTER TABLE blog_plans
ADD COLUMN IF NOT EXISTS product_family TEXT,
ADD COLUMN IF NOT EXISTS product_subfamily TEXT;

UPDATE blog_posts p
SET product_family = k.product_family,
    product_subfamily = k.subfamily
FROM blog_keywords k
WHERE LOWER(k.keyword) = LOWER(p.main_keyword)
  AND p.product_family IS NULL;

UPDATE blog_plans p
SET product_family = k.product_family,
    product_subfamily = k.subfamily
FROM blog_keywords k
WHERE LOWER(k.keyword) = LOWER(p.keyword)
  AND p.product_family IS NULL;

CREATE INDEX IF NOT EXISTS idx_blog_posts_product_family ON blog_posts(product_family, status);
CREATE INDEX IF NOT EXISTS idx_blog_plans_product_family ON blog_plans(product_family, status);

-- 原结构只允许关键词文本全局唯一，无法保存不同国家/产品的同名关键词。
ALTER TABLE blog_keywords DROP CONSTRAINT IF EXISTS blog_keywords_keyword_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_keywords_scope
ON blog_keywords(keyword, product_family, COALESCE(subfamily, ''), country);
