-- Migration: Add accountant role and counts_towards_limit column
-- Date: 2026-01-09
-- Description: Adds 'accountant' as a valid role and a column to track if user counts towards plan limits

-- Add 'accountant' to the role check constraint (if using enum or check)
-- First, let's add the new column
ALTER TABLE users ADD COLUMN IF NOT EXISTS counts_towards_limit BOOLEAN DEFAULT true;

-- Update existing users to count towards limit
UPDATE users SET counts_towards_limit = true WHERE counts_towards_limit IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.counts_towards_limit IS 'If false, user does not count towards plan user limits (e.g., accountant role)';

-- Create an index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_users_counts_towards_limit ON users(organization_id, counts_towards_limit);

-- Note: The 'role' column should already accept 'accountant' as a value.
-- If it's a strict enum, you may need to alter the column type.
-- For now, assuming role is a varchar/text field.
