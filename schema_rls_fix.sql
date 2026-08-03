-- =============================================
-- RLS 安全修复补丁
-- 针对 setup_database.sql 中所有未开 RLS 的表
-- 策略：禁止 anon 直接访问，后端用 service_role key 绕过 RLS
-- 执行方式：粘贴到 Supabase SQL Editor → Run
-- =============================================

-- 1. 客户表
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- 2. 产品表
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 3. 供应商表
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- 4. 产品供应商关联表
ALTER TABLE product_suppliers ENABLE ROW LEVEL SECURITY;

-- 5. 询盘表
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

-- 6. 订单表
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 7. 订单明细表
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- 8. 文档表
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- 9. 文档模板表
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

-- 10. 文档导出记录表
ALTER TABLE document_exports ENABLE ROW LEVEL SECURITY;

-- 11. 邮件表
ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

-- 12. AI 设置表（含 api_key！）
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;

-- 13. 密码保险箱（含 password_encrypted！）
ALTER TABLE password_items ENABLE ROW LEVEL SECURITY;

-- 14. 保险箱安全表（含 second_pass_hash！）
ALTER TABLE vault_security ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 说明：
-- 开启 RLS 后，没有显式 policy 的表默认拒绝所有 anon 访问。
-- 后端使用 SUPABASE_SERVICE_ROLE_KEY 时会绕过 RLS，不受影响。
-- 如果前端直接用 anon key 访问某些表，需要额外添加 policy，
-- 否则那些请求会 403 — 届时再按需添加。
-- =============================================
