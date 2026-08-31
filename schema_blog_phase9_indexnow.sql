-- =============================================
-- BLOG 自动化系统 - 第 9 阶段（IndexNow 提交管理）
-- =============================================

CREATE TABLE IF NOT EXISTS indexnow_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_ids UUID[] NOT NULL,
  urls TEXT[] NOT NULL,
  url_count INT NOT NULL DEFAULT 1,
  submission_type TEXT NOT NULL DEFAULT 'manual', -- manual | auto
  status TEXT NOT NULL DEFAULT 'success', -- success | failed
  http_status INT,
  error_message TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexnow_submissions_submitted_at
  ON indexnow_submissions(submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_indexnow_submissions_blog_ids
  ON indexnow_submissions USING GIN(blog_ids);

-- 为已发布的文章添加 indexnow 提交追踪字段（可选，用于快速查询）
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS indexnow_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS indexnow_last_status TEXT;

CREATE INDEX IF NOT EXISTS idx_blog_posts_indexnow_submitted
  ON blog_posts(indexnow_submitted_at)
  WHERE status = 'published';

ALTER TABLE indexnow_submissions ENABLE ROW LEVEL SECURITY;

-- CRM 后端使用 service role key 访问；前端不直接访问此表。

COMMENT ON TABLE indexnow_submissions IS 'IndexNow 提交历史记录';
COMMENT ON COLUMN indexnow_submissions.blog_ids IS '提交的文章 ID 数组';
COMMENT ON COLUMN indexnow_submissions.urls IS '提交的 URL 数组';
COMMENT ON COLUMN indexnow_submissions.submission_type IS 'manual=手动提交, auto=发布时自动提交';
COMMENT ON COLUMN indexnow_submissions.status IS 'success=成功, failed=失败';
