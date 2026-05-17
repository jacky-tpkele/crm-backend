-- ════════════════════════════════════════════════════════════
-- v2.8: customers 表新增 contact_person + delivery_term
-- 对应 PI 的 ATTN 和 Delivery Term 字段
-- ════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS delivery_term  TEXT;
