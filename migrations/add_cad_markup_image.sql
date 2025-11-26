-- Add cad_markup_image column to quotes table
-- This stores the base64-encoded canvas image data (with annotations)

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS cad_markup_image TEXT;

-- Add comment to describe the column
COMMENT ON COLUMN quotes.cad_markup_image IS 'Base64-encoded PNG image data containing CAD markup annotations';
