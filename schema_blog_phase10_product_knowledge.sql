-- BLOG 自动化系统 - 第 10 阶段：产品项目知识库

CREATE TABLE IF NOT EXISTS blog_knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_family TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  source_file TEXT,
  status TEXT DEFAULT 'draft',
  allowed_for_ai BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_knowledge_product ON blog_knowledge_items(product_family);
CREATE INDEX IF NOT EXISTS idx_blog_knowledge_section ON blog_knowledge_items(product_family, section);
CREATE INDEX IF NOT EXISTS idx_blog_knowledge_ai ON blog_knowledge_items(product_family, allowed_for_ai);

ALTER TABLE blog_knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read blog knowledge"
  ON blog_knowledge_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users to insert blog knowledge"
  ON blog_knowledge_items FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users to update blog knowledge"
  ON blog_knowledge_items FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Allow authenticated users to delete blog knowledge"
  ON blog_knowledge_items FOR DELETE USING (auth.role() = 'authenticated');
