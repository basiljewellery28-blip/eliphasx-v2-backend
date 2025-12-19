-- Migration: Add user and organization profile fields
-- Version: 005_user_profile.sql

-- User profile fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_privacy_at TIMESTAMP;

-- Organization profile fields
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS province VARCHAR(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'South Africa';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS company_size VARCHAR(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS industry VARCHAR(100) DEFAULT 'Jewellery Manufacturing';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registration_number VARCHAR(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vat_number VARCHAR(20);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_organizations_province ON organizations(province);
CREATE INDEX IF NOT EXISTS idx_organizations_company_size ON organizations(company_size);
CREATE INDEX IF NOT EXISTS idx_users_names ON users(first_name, last_name);
