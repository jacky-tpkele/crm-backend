-- v2.2: 物流单加 shipment_items 列（记录本批装了哪些产品及数量）
-- 结构: [{ "product_id": "<uuid>", "product_name_cn": "...", "quantity": 10 }, ...]
-- 兼容旧数据：列允许为空，旧物流单不受影响

ALTER TABLE logistics ADD COLUMN IF NOT EXISTS shipment_items JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_logistics_shipment_items ON logistics USING GIN (shipment_items);
