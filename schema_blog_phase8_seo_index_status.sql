-- =============================================
-- BLOG 自动化系统 - 第 8 阶段（SEO Indexing / Sitemap 检测状态）
-- =============================================

CREATE TABLE IF NOT EXISTS seo_index_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  http_status INT,
  page_accessible BOOLEAN DEFAULT FALSE,
  in_sitemap BOOLEAN DEFAULT FALSE,
  sitemap_url_found TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  check_count INT NOT NULL DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,
  first_checked_at TIMESTAMPTZ,
  final_checked_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(blog_id)
);

CREATE INDEX IF NOT EXISTS idx_seo_index_status_blog_id
  ON seo_index_status(blog_id);

CREATE INDEX IF NOT EXISTS idx_seo_index_status_status
  ON seo_index_status(status);

CREATE INDEX IF NOT EXISTS idx_seo_index_status_next_check
  ON seo_index_status(next_check_at)
  WHERE next_check_at IS NOT NULL;

ALTER TABLE seo_index_status ENABLE ROW LEVEL SECURITY;

-- CRM 后端使用 service role key 访问；前端不直接访问此表。
