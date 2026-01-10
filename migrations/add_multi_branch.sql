-- Migration: Multi-Branch Support for Enterprise Plans
-- Date: 2026-01-10
-- Description: Allows Enterprise organizations to manage multiple branches with shared users

-- 1. Create organization_groups table (parent container for branches)
CREATE TABLE IF NOT EXISTS organization_groups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    owner_organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add group reference and is_branch flag to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES organization_groups(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_branch BOOLEAN DEFAULT false;

-- 3. Create user_branch_access table for cross-branch permissions
CREATE TABLE IF NOT EXISTS user_branch_access (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'sales',
    granted_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, organization_id)
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_groups_owner ON organization_groups(owner_organization_id);
CREATE INDEX IF NOT EXISTS idx_org_group_id ON organizations(group_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_access_user ON user_branch_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_access_org ON user_branch_access(organization_id);

-- 5. Add comments
COMMENT ON TABLE organization_groups IS 'Groups multiple organizations under one Enterprise account';
COMMENT ON COLUMN organizations.group_id IS 'Reference to parent organization group (for branches)';
COMMENT ON COLUMN organizations.is_branch IS 'True if this org is a branch of a parent org';
COMMENT ON TABLE user_branch_access IS 'Grants users access to additional organizations beyond their primary';
