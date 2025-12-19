-- Migration to add status column to organizations table
-- Status can be 'active', 'trial', 'suspended'

-- Add status column if it doesn't exist
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- Update existing organizations to have status based on subscription_status
UPDATE organizations SET status = COALESCE(subscription_status, 'active') WHERE status IS NULL;

-- Create index for status queries
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
