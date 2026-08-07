-- =============================================
-- v2.17 多邮箱账号支持修复
-- 执行方式：粘贴到 Supabase SQL Editor → Run
--
-- 解决两个问题：
--   1. 历史邮件的 account_id 为 NULL，切到具体账号时看不到邮件
--   2. message_id 全局 UNIQUE，导致两个账号收到同一封邮件（CC/群发）时
--      第二个账号会被 ignore-duplicates 静默丢弃
-- =============================================

-- ── 步骤 1：先看一下要处理的数据量（只读，可单独跑）──
-- SELECT
--   (SELECT count(*) FROM emails WHERE account_id IS NULL)              AS 待回填邮件数,
--   (SELECT count(*) FROM email_accounts WHERE is_active)               AS 启用账号数,
--   (SELECT count(*) FROM (
--      SELECT message_id FROM emails
--      WHERE message_id IS NOT NULL
--      GROUP BY message_id HAVING count(*) > 1
--    ) t)                                                              AS 重复message_id数;


-- ── 步骤 2：把 account_id 为空的历史邮件回填到默认账号 ──
-- 默认账号 = email_accounts 里 created_at 最早的那个（与后端 resolveAccount 一致）
UPDATE emails
SET account_id = (
  SELECT id FROM email_accounts
  WHERE is_active
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE account_id IS NULL
  AND EXISTS (SELECT 1 FROM email_accounts WHERE is_active);


-- ── 步骤 3：message_id 唯一约束改为「按账号唯一」──
-- 原约束是全局唯一，多账号下会互相顶掉。改成 (account_id, message_id) 复合唯一。

-- 3a. 先删掉可能存在的跨账号重复行，只保留每组最早的一条，
--     否则下面建唯一索引会失败。
DELETE FROM emails a
USING emails b
WHERE a.message_id IS NOT NULL
  AND a.message_id = b.message_id
  AND COALESCE(a.account_id::text, '') = COALESCE(b.account_id::text, '')
  AND a.ctid > b.ctid;

-- 3b. 删除旧的全局唯一约束（约束名可能是 emails_message_id_key，
--     若你的库里名字不同，跑 \d emails 查一下再改这里）
ALTER TABLE emails DROP CONSTRAINT IF EXISTS emails_message_id_key;

-- 3c. 建立按账号的复合唯一索引。
--     用 UNIQUE INDEX 而非 CONSTRAINT，这样 PostgREST 的
--     on_conflict=account_id,message_id 能正常识别。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_emails_account_message
  ON emails (account_id, message_id);

-- 3d. 按账号查邮件的索引（列表页每次都按 account_id + folder 过滤）
CREATE INDEX IF NOT EXISTS idx_emails_account ON emails (account_id);


-- ── 步骤 4：验证 ──
-- SELECT
--   (SELECT count(*) FROM emails WHERE account_id IS NULL) AS 仍为空的邮件数,
--   (SELECT count(*) FROM emails)                          AS 邮件总数;
