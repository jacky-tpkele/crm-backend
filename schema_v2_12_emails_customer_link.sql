-- ════════════════════════════════════════════════════════════
-- v2.12: 邮件 ↔ 客户关联
-- 现状：emails 表与 customers 表完全无关联，邮件孤立
-- 目标：emails 加 customer_id 字段；后端在写入邮件时自动按 from_address 匹配客户邮箱
-- ════════════════════════════════════════════════════════════

ALTER TABLE emails ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_emails_customer ON emails(customer_id) WHERE is_deleted = FALSE;

-- 一次性回填：把历史邮件按 from_address 匹配到 customers.email
-- 注意：customers.email 可能存多个邮箱（逗号分隔），这里只匹配完全等于第一个邮箱的简单情况
UPDATE emails e
SET    customer_id = c.id
FROM   customers c
WHERE  e.customer_id IS NULL
  AND  c.email IS NOT NULL
  AND  LOWER(TRIM(SPLIT_PART(c.email, ',', 1))) = LOWER(TRIM(e.from_address));
