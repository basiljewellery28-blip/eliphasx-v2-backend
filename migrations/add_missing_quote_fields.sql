-- Add missing columns to quotes table for complete data integrity

-- CAD include toggles
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS include_rendering_cost BOOLEAN DEFAULT FALSE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS include_technical_cost BOOLEAN DEFAULT FALSE;

-- Stones section
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS stone_categories JSONB DEFAULT '[]';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS stone_markup DECIMAL(5,2) DEFAULT 0;

-- Finishing section
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS finishing_cost DECIMAL(10,2) DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS plating_cost DECIMAL(10,2) DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS include_plating_cost BOOLEAN DEFAULT FALSE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS finishing_markup DECIMAL(5,2) DEFAULT 0;

-- Findings section
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS findings JSONB DEFAULT '[]';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS findings_markup DECIMAL(5,2) DEFAULT 0;
