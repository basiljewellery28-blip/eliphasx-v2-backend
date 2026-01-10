-- Migration: Add seat addons for flexible user limits
-- Date: 2026-01-10
-- Description: Allows organizations to purchase additional user seats beyond their plan limit

-- Create seat_addons table
CREATE TABLE IF NOT EXISTS seat_addons (
    id SERIAL PRIMARY KEY,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1,
    price_per_seat_cents INTEGER NOT NULL DEFAULT 20000, -- R200 = 20000 cents
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, cancelled
    paystack_subscription_code VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cancelled_at TIMESTAMP,
    UNIQUE(organization_id) -- One addon record per org
);

-- Add index for quick lookups
CREATE INDEX IF NOT EXISTS idx_seat_addons_org ON seat_addons(organization_id);

-- Add comments
COMMENT ON TABLE seat_addons IS 'Tracks additional user seats purchased beyond plan limits';
COMMENT ON COLUMN seat_addons.quantity IS 'Number of extra seats purchased';
COMMENT ON COLUMN seat_addons.price_per_seat_cents IS 'Price per seat in cents (e.g., 20000 = R200)';
