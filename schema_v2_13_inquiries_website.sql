-- 询盘表扩展：支持网站表单提交的完整字段
-- 与现有 dashboard.html 的 New/Edit Inquiry 兼容（customer_name/inquiry_date/status/notes 不变）

ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS product_interest  TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS subject           TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS message           TEXT;
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS source            TEXT DEFAULT 'manual';
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_inquiries_source     ON inquiries(source);
CREATE INDEX IF NOT EXISTS idx_inquiries_email      ON inquiries(email);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_at ON inquiries(created_at DESC);
