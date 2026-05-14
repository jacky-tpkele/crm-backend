-- ════════════════════════════════════════════════════════════
-- v2.4: products 表新增 brand 列（取代旧 certification 字段）
-- 老的 certification 列保留不动，避免历史数据丢失；UI 上已读 brand。
-- 在 Supabase SQL Editor 执行一次即可。
-- ════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;

-- 把已有 certification 的数据迁到 brand（只迁空的，不覆盖已填）
UPDATE products
   SET brand = certification
 WHERE brand IS NULL
   AND certification IS NOT NULL
   AND certification <> '';
