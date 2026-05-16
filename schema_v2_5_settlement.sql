-- ════════════════════════════════════════════════════════════
-- v2.5: orders 表新增"汇率结算"相关字段
-- 业务背景：订单录入时按当日汇率计算 profit/profit_rmb，但实际到账可能
-- 几天/几周后，汇率已变动。新增 settlement_* 字段允许按结算日汇率重算"实际利润"。
-- 老字段 profit/profit_rmb/profit_rate 保留作为"录入时利润"基准，不再修改。
-- 在 Supabase SQL Editor 执行一次即可。
-- ════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_rate    NUMERIC(10,4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_date    DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_profit      NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_profit_rmb  NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS actual_profit_rate NUMERIC(6,2);

-- 索引：仪表盘按结算状态过滤会用到
CREATE INDEX IF NOT EXISTS idx_orders_settled
  ON orders(settlement_date)
  WHERE is_deleted = FALSE AND settlement_date IS NOT NULL;
