-- v2.14 实时聊天（网站 ↔ CRM）+ Web Push 订阅
-- 三张表：
--   chat_sessions       一次访客会话（从打开浮窗到关闭浏览器都算一次）
--   chat_messages       会话里的每条消息（访客或客服发出）
--   push_subscriptions  CRM 用户（iPhone PWA 等）注册的 Web Push 推送目标

-- ── chat_sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id      TEXT NOT NULL,                       -- 浏览器 localStorage 里持久化的匿名 UUID
  visitor_name    TEXT,                                -- 访客可选填的姓名
  visitor_email   TEXT,                                -- 访客可选填的邮箱
  page_url        TEXT,                                -- 发起会话时所在的页面 URL（便于客服了解上下文）
  user_agent      TEXT,                                -- 浏览器信息
  status          TEXT NOT NULL DEFAULT 'open',        -- open / closed
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  unread_for_agent INT NOT NULL DEFAULT 0,             -- 客服侧未读数
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor   ON chat_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status    ON chat_sessions(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_unread    ON chat_sessions(unread_for_agent) WHERE unread_for_agent > 0;

-- ── chat_messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL CHECK (sender IN ('visitor','agent','system')),
  agent_id    UUID,                                    -- 客服时存 users.id；访客/system 时为 NULL
  body        TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,          -- 对方是否已读
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

-- 启用 Realtime（前端用 Supabase Realtime 订阅本表的 INSERT 拿到推送）
-- 如果 publication 已存在，IF NOT EXISTS 也不会报错
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE chat_messages, chat_sessions;
  ELSE
    -- 已有 publication，加 table（重复执行不报错）
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_sessions;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END$$;

-- ── push_subscriptions ───────────────────────────────────────
-- 每条记录代表一个浏览器/PWA 的推送端点
-- 同一个用户可以有多端：iPhone PWA、电脑 Chrome 等
-- 注：user_id 不加外键约束，因为 users 表可能尚未创建（CRM 现在是单用户模式，靠环境变量登录）
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,                                    -- 关联 users.id（若 users 表存在）；当前可为 NULL
  endpoint    TEXT NOT NULL UNIQUE,                    -- 浏览器返回的推送服务 URL（Apple/Google/Mozilla 各家）
  p256dh      TEXT NOT NULL,                           -- 加密用公钥
  auth        TEXT NOT NULL,                           -- 加密用 auth secret
  user_agent  TEXT,
  device_name TEXT,                                    -- 用户可命名，比如 "iPhone 主屏幕"
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
