-- ════════════════════════════════════════════════════════════
-- v2.15: 修复 Products/Suppliers 字段不匹配问题
-- 日期: 2026-08-03
-- 问题: 前端提交的字段在数据库表中不存在，导致新增失败
-- ════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────
-- 1. Products 表：添加缺失字段
-- ──────────────────────────────────────────

-- 添加品牌字段（前端有输入框但数据库没有）
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT;

-- 添加双币种销售价字段（前端分 USD/RMB，数据库只有一个 default_sales_price）
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_sales_price_usd NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_sales_price_rmb NUMERIC(12,2);

-- 数据迁移：如果旧数据有 default_sales_price，假设是 USD，迁移到 _usd 列
UPDATE products
SET default_sales_price_usd = default_sales_price
WHERE default_sales_price_usd IS NULL
  AND default_sales_price IS NOT NULL
  AND default_sales_price > 0;

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand) WHERE is_deleted = FALSE;

-- 注释说明
COMMENT ON COLUMN products.brand IS '产品品牌（如 Philips、欧司朗）';
COMMENT ON COLUMN products.default_sales_price_usd IS '默认销售价 USD（与 _rmb 二选一填，前端自动汇率联动）';
COMMENT ON COLUMN products.default_sales_price_rmb IS '默认销售价 RMB（与 _usd 二选一填，前端自动汇率联动）';

-- ──────────────────────────────────────────
-- 2. 确认依赖表存在
-- ──────────────────────────────────────────

-- product_suppliers 表应该已存在（schema_v2_upgrade.sql 创建）
-- supplier_contacts 表应该已存在（schema_v2_upgrade.sql 创建）

-- 检查确认：如果下面两条查询返回数据，说明表存在
-- SELECT COUNT(*) FROM product_suppliers;
-- SELECT COUNT(*) FROM supplier_contacts;

-- ──────────────────────────────────────────
-- 3. 可选：清理旧字段（谨慎执行）
-- ──────────────────────────────────────────

-- 如果确认不再需要旧的 default_sales_price 字段，可以删除
-- 建议：先运行一段时间，确认新字段正常后再执行
-- ALTER TABLE products DROP COLUMN IF EXISTS default_sales_price;

-- ──────────────────────────────────────────
-- 完成
-- ──────────────────────────────────────────

-- 执行后验证：
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'products'
--   AND column_name IN ('brand', 'default_sales_price_usd', 'default_sales_price_rmb')
-- ORDER BY ordinal_position;
