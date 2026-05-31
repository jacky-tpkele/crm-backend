-- =============================================
-- BLOG 自动化系统 - 第 7 阶段（已发布文章管理 + 审计日志）
-- =============================================

-- 1. blog_posts 加一个 archived_at 字段，记录下线时间
--    （状态值 archived 不需要建表改动，直接用现有 status TEXT 字段存）
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 2. 审计日志表 —— 记录每篇文章的关键事件时间线
CREATE TABLE IF NOT EXISTS blog_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID REFERENCES blog_posts(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  -- action 取值：
  --   created            (文章生成)
  --   regenerated        (用新 Prompt 重新生成)
  --   edited             (审核工作台手动改了内容)
  --   approved_published (批准并发布)
  --   archived           (下线)
  --   republished        (重新上线)
  --   deleted            (永久删除前最后一条记录)
  --   image_uploaded     (上传图片，可选记录)
  detail      TEXT,                  -- 简短描述（如 "Cover image uploaded"）
  meta        JSONB DEFAULT '{}',    -- 详细数据（如 word count, slug, 等）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_audit_log_post_id
  ON blog_audit_log(post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_audit_log_action
  ON blog_audit_log(action);

-- 启用 RLS：只用 service key 访问（CRM 后端用 service key，前端不能直接读）
ALTER TABLE blog_audit_log ENABLE ROW LEVEL SECURITY;

-- 3. 已发布文章列表索引优化
CREATE INDEX IF NOT EXISTS idx_blog_posts_published_at
  ON blog_posts(published_at DESC) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_blog_posts_archived_at
  ON blog_posts(archived_at DESC) WHERE status = 'archived';
