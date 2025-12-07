-- =============================================
-- ELIPHASx Multi-Tenant SaaS Migration
-- Phase 1: Organizations & Subscriptions
-- =============================================

-- 1. Create organizations table (tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    logo_url TEXT,
    plan VARCHAR(50) DEFAULT 'trial',
    subscription_status VARCHAR(50) DEFAULT 'trial',
    trial_ends_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days'),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    billing_cycle VARCHAR(20) DEFAULT 'monthly',
    status VARCHAR(50) DEFAULT 'active',
    gateway VARCHAR(50) DEFAULT 'paystack',
    gateway_subscription_code VARCHAR(255),
    gateway_customer_code VARCHAR(255),
    gateway_email_token VARCHAR(255),
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create payment_history table
CREATE TABLE IF NOT EXISTS payment_history (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES subscriptions(id),
    amount_cents INTEGER NOT NULL,
    currency VARCHAR(3) DEFAULT 'ZAR',
    status VARCHAR(50) NOT NULL,
    gateway_reference VARCHAR(255),
    gateway_response JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Add organization_id to existing tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE metal_prices ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);

-- 5. Create default organization for existing data
INSERT INTO organizations (name, slug, plan, subscription_status)
VALUES ('Default Organization', 'default', 'business', 'active')
ON CONFLICT (slug) DO NOTHING;

-- 6. Migrate existing data to default organization
UPDATE users SET organization_id = (SELECT id FROM organizations WHERE slug = 'default') WHERE organization_id IS NULL;
UPDATE clients SET organization_id = (SELECT id FROM organizations WHERE slug = 'default') WHERE organization_id IS NULL;
UPDATE quotes SET organization_id = (SELECT id FROM organizations WHERE slug = 'default') WHERE organization_id IS NULL;

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_quotes_org ON quotes(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);

-- 8. Add is_owner flag to users (first user of org becomes owner)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_org_owner BOOLEAN DEFAULT FALSE;
