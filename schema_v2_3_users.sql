-- ════════════════════════════════════════════════════════════
-- v2.3: 多用户结构预留
-- 当前还是单用户（管理员），但数据库 + 后端把扩展点打好
-- ════════════════════════════════════════════════════════════

-- 1. users 表
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'sales',  -- admin / sales / purchase / viewer
  email         TEXT,
  phone         TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  is_deleted    BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role)     WHERE is_deleted = FALSE;

-- 2. 业务表加 created_by 列（NULL = 旧数据，新写入会自动填）
-- 不加外键约束，避免删用户时业务数据级联崩溃（用业务规则约束更灵活）
ALTER TABLE customers       ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE products        ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE suppliers       ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE logistics       ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE inquiries       ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by UUID;

-- 索引：未来按用户过滤会用到
CREATE INDEX IF NOT EXISTS idx_customers_created_by  ON customers(created_by)  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_products_created_by   ON products(created_by)   WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by  ON suppliers(created_by)  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_created_by     ON orders(created_by)     WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_logistics_created_by  ON logistics(created_by);
CREATE INDEX IF NOT EXISTS idx_inquiries_created_by  ON inquiries(created_by);
CREATE INDEX IF NOT EXISTS idx_po_created_by         ON purchase_orders(created_by);

-- 3. 不预先插入 admin 用户：后端 ensureAdminUser() 启动时按 CRM_USERNAME 自动 bootstrap
--    优势：管理员账号始终对应环境变量里的值，改 env 后下一次登录自动建/更新对应记录
