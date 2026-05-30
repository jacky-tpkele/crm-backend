-- =============================================
-- BLOG 自动化 - 添加自动生成控制字段
-- =============================================

-- 添加字段到 blog_config 表
ALTER TABLE blog_config
ADD COLUMN IF NOT EXISTS auto_generation_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS last_generation_time TIMESTAMPTZ;

-- 初始化配置
INSERT INTO blog_config (config_key, config_value, auto_generation_enabled, last_generation_time)
VALUES
  ('auto_generation_enabled', 'true', true, NOW()),
  ('last_generation_time', NOW()::text, true, NOW())
ON CONFLICT (config_key) DO UPDATE SET
  auto_generation_enabled = EXCLUDED.auto_generation_enabled,
  last_generation_time = EXCLUDED.last_generation_time;
