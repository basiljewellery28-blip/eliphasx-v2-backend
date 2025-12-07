-- Migration to consolidate user roles: Convert 'manager' to 'admin'

UPDATE users 
SET role = 'admin' 
WHERE role = 'manager';

-- Ensure only 'admin' and 'sales' (or 'user') exist (optional cleanup/validation)
-- We strictly follow user request: "only two types of users the admin and the normal user"
-- Assuming 'sales' is the normal user based on initial schema default.
