-- =============================================
-- v2.1 增量补丁 — 产品销售价改成 USD/RMB 双字段
-- 在 Supabase SQL Editor 执行
-- =============================================

-- 1. 产品表加两个新销售价字段
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_sales_price_usd NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_sales_price_rmb NUMERIC(12,2);

-- 2. 旧的 default_sales_price 数据迁移到 USD（如有）
UPDATE products
   SET default_sales_price_usd = default_sales_price
 WHERE default_sales_price_usd IS NULL
   AND default_sales_price IS NOT NULL
   AND default_sales_price > 0;
