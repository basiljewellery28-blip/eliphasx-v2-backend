-- Default admin user (password: 'admin123' - hashed)
INSERT INTO users (email, password_hash, role) 
VALUES ('admin@eliphasx.com', '$2b$10$YourHashedPasswordHere', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Initial metal prices
INSERT INTO metal_prices (metal_type, price, alloy_composition) VALUES
('18ct_yellow_gold', 850, '75% Au, 12.5% Ag, 12.5% Cu'),
('18ct_white_gold', 850, '75% Au, 10% Pd, 15% Ag'),
('18ct_rose_gold', 850, '75% Au, 5% Ag, 20% Cu'),
('14ct_yellow_gold', 650, '58.5% Au, 41.5% Ag/Cu'),
('platinum_950', 1200, '95% Pt, 5% Ru/Ir'),
('sterling_silver', 12, '92.5% Ag, 7.5% Cu')
ON CONFLICT (metal_type) DO UPDATE 
SET price = EXCLUDED.price;
