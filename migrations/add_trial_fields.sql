-- Migration: Enhanced Trial System
-- Date: 2026-01-10
-- Description: Adds trial_ends_at and expected_team_size to organizations

-- Add trial fields to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS expected_team_size VARCHAR(20);

-- Migrate existing trial users to Professional with 28-day trial
-- Calculate trial_ends_at from created_at + 28 days
UPDATE organizations 
SET plan = 'professional',
    trial_ends_at = created_at + INTERVAL '28 days',
    expected_team_size = 'unknown'
WHERE plan = 'trial';

-- For users already past their theoretical trial end, give them 7 more days from now
UPDATE organizations 
SET trial_ends_at = NOW() + INTERVAL '7 days'
WHERE plan = 'professional' 
  AND trial_ends_at IS NOT NULL 
  AND trial_ends_at < NOW();

-- Add index for quick trial expiry checks
CREATE INDEX IF NOT EXISTS idx_org_trial_ends ON organizations(trial_ends_at);

-- Comments
COMMENT ON COLUMN organizations.trial_ends_at IS 'When the trial period ends (null = not on trial)';
COMMENT ON COLUMN organizations.expected_team_size IS 'Team size selected during registration';
