-- ════════════════════════════════════════════════════════════
-- v2.18: customers 表补加 contact_person + delivery_term
-- （v2.8 的迁移从未在生产库执行，这里重新补上）
-- 用 IF NOT EXISTS 保证幂等，重复执行不报错
-- ════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS delivery_term  TEXT;
