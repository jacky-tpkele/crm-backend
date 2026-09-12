-- =============================================
-- BLOG 自动化 - Phase 10: AI素材库 + 多插图管理
-- =============================================
-- 创建时间: 2026-09-11
-- 用途: 支持从AI对话内容生成文章，并管理文章多张插图

-- 1. AI素材表
CREATE TABLE IF NOT EXISTS blog_ai_materials (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(500),                           -- 素材标题
  content TEXT NOT NULL,                        -- AI对话内容/原始素材
  source_type VARCHAR(50) DEFAULT 'manual',     -- 来源: manual(手动输入), api(API对接)

  -- AI提取的信息
  extracted_keywords TEXT[],                    -- 提取的关键词
  extracted_topics TEXT[],                      -- 提取的主题
  suggested_title VARCHAR(500),                 -- AI建议的标题
  article_type VARCHAR(50),                     -- 建议的文章类型(product/buying/comparison/application/faq)

  -- 插图需求信息
  image_requirements JSONB,                     -- 插图需求描述
  /* 格式示例:
  {
    "count": 3,
    "suggestions": [
      {
        "position": "intro",
        "description": "AC MCB产品外观图",
        "type": "product",
        "alt_text": "AC Miniature Circuit Breaker"
      }
    ]
  }
  */

  -- 用户设置
  tags TEXT[],                                  -- 用户标签
  priority INT DEFAULT 0,                       -- 优先级(0-5)
  notes TEXT,                                   -- 备注

  -- 状态管理
  status VARCHAR(50) DEFAULT 'pending',         -- pending/analyzed/used/archived
  used_count INT DEFAULT 0,                     -- 被使用次数
  last_used_at TIMESTAMP WITH TIME ZONE,        -- 最后使用时间

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 文章插图表(支持多张图片)
CREATE TABLE IF NOT EXISTS blog_post_images (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,

  -- 图片文件信息
  image_url TEXT NOT NULL,                      -- Cloudinary URL
  cloudinary_id TEXT,                           -- Cloudinary Public ID

  -- 图片元信息
  position VARCHAR(50),                         -- intro/section1/section2/conclusion/featured
  alt_text VARCHAR(500),                        -- SEO友好的alt文本
  caption TEXT,                                 -- 图片说明文字
  image_type VARCHAR(50),                       -- product/diagram/comparison/infographic/hero

  -- 尺寸和压缩信息
  width INT,
  height INT,
  original_size INT,                            -- 原始大小(bytes)
  compressed_size INT,                          -- 压缩后大小(bytes)
  format VARCHAR(20),                           -- webp/jpg/png

  -- AI生成信息(如果是AI生成的图)
  ai_generated BOOLEAN DEFAULT FALSE,
  generation_prompt TEXT,                       -- AI生成时使用的prompt

  -- 排序
  sort_order INT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 为blog_posts表添加material_id外键
ALTER TABLE blog_posts
ADD COLUMN IF NOT EXISTS material_id BIGINT REFERENCES blog_ai_materials(id) ON DELETE SET NULL;

-- 4. 创建索引
CREATE INDEX IF NOT EXISTS idx_blog_ai_materials_status ON blog_ai_materials(status);
CREATE INDEX IF NOT EXISTS idx_blog_ai_materials_article_type ON blog_ai_materials(article_type);
CREATE INDEX IF NOT EXISTS idx_blog_ai_materials_created_at ON blog_ai_materials(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_material_id ON blog_posts(material_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_images_post_id ON blog_post_images(post_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_images_sort ON blog_post_images(post_id, sort_order);

-- 5. 添加注释
COMMENT ON TABLE blog_ai_materials IS 'AI素材库 - 存储AI对话内容用于生成文章';
COMMENT ON TABLE blog_post_images IS '文章插图表 - 支持每篇文章多张图片';
COMMENT ON COLUMN blog_posts.material_id IS '关联的AI素材ID';

-- 6. RLS策略(如果启用了RLS)
ALTER TABLE blog_ai_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_post_images ENABLE ROW LEVEL SECURITY;

-- 允许匿名用户读取(用于前端展示)
CREATE POLICY "Allow anon read blog_ai_materials" ON blog_ai_materials
  FOR SELECT USING (true);

CREATE POLICY "Allow anon all blog_post_images" ON blog_post_images
  USING (true);
