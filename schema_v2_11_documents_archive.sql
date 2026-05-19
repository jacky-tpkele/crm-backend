-- ════════════════════════════════════════════════════════════
-- v2.11: documents 表存档功能完善
-- 现状：documents 表只有最基本字段，前端 documents.html 生成 PDF 但不存档
-- 目标：把生成的 PI/Quotation/Packing List 存入数据库，可追溯、可重新打印
-- ════════════════════════════════════════════════════════════

ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number TEXT;     -- INV-202601001 / QUO-202601001 / PKL-...
ALTER TABLE documents ADD COLUMN IF NOT EXISTS html_content    TEXT;     -- 生成时的 HTML 快照（含编辑后的内容）
ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by      UUID;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE documents ADD COLUMN IF NOT EXISTS notes           TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_deleted      BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_type  ON documents(document_type, created_at DESC) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_documents_number ON documents(document_number) WHERE is_deleted = FALSE;
