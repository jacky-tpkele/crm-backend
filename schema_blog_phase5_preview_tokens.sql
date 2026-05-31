-- =============================================
-- BLOG 自动化系统 - 第 5 阶段升级（预览 token）
-- =============================================

-- 1. 预览 token 表（一次性、限时、按 postId 关联）
CREATE TABLE IF NOT EXISTS blog_preview_tokens (
  token        TEXT PRIMARY KEY,
  post_id      UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_count   INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_blog_preview_tokens_expires_at ON blog_preview_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_blog_preview_tokens_post_id ON blog_preview_tokens(post_id);

-- RLS：开启但不写策略，确保只能用 service key 访问
ALTER TABLE blog_preview_tokens ENABLE ROW LEVEL SECURITY;

-- 2. 自动清理：每天清理过期 24 小时以上的 token（手动跑或建定时任务）
-- DELETE FROM blog_preview_tokens WHERE expires_at < now() - interval '24 hours';
