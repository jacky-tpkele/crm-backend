-- =============================================
-- v2.16: Email Accounts Multi-Account Support
-- 用法：复制整个文件内容 → Supabase SQL Editor → Run
-- =============================================

-- 1. 创建邮箱账号表
CREATE TABLE IF NOT EXISTS email_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email        TEXT NOT NULL,
  from_name    TEXT,
  imap_host    TEXT NOT NULL,
  imap_port    INTEGER DEFAULT 993,
  smtp_host    TEXT NOT NULL,
  smtp_port    INTEGER DEFAULT 465,
  username     TEXT NOT NULL,
  password     TEXT NOT NULL,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_active ON email_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_email_accounts_email  ON email_accounts(email);

-- 2. 给 emails 表加 account_id 列（兼容已有数据，允许 null）
ALTER TABLE emails ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id);

-- 完成
-- 注：默认账号（jacky@tpkele.com）由后端从 Vercel 环境变量自动写入，无需在此手动插入密码
