-- Insert default metal prices
INSERT INTO metal_prices (metal_type, price, alloy_composition) VALUES
('18ct_yellow_gold', 850, '75% Au, 12.5% Ag, 12.5% Cu'),
('18ct_white_gold', 850, '75% Au, 10% Pd, 15% Ag'),
('18ct_rose_gold', 850, '75% Au, 5% Ag, 20% Cu'),
('14ct_yellow_gold', 650, '58.5% Au, 41.5% Ag/Cu'),
('14ct_white_gold', 650, '58.5% Au, 20% Pd, 21.5% Ag'),
('14ct_rose_gold', 650, '58.5% Au, 10% Ag, 31.5% Cu'),
('9ct_yellow_gold', 450, '37.5% Au, 62.5% Ag/Cu'),
('9ct_white_gold', 450, '37.5% Au, 25% Pd, 37.5% Ag'),
('9ct_rose_gold', 450, '37.5% Au, 15% Ag, 47.5% Cu'),
('platinum_950', 1200, '95% Pt, 5% Ru/Ir'),
('platinum_900', 1150, '90% Pt, 10% Ir'),
('platinum_850', 1100, '85% Pt, 15% Pd'),
('sterling_silver', 12, '92.5% Ag, 7.5% Cu')
ON CONFLICT (metal_type) DO UPDATE 
SET price = EXCLUDED.price;

-- Create default admin user (password: ELIPHASxAdmin2024)
INSERT INTO users (email, password_hash, role) VALUES 
('admin@eliphasx.com', '$2b$10$8V17k.9WZRzVH3Vv5XqY3uL1V2sA5bC6dE7fG8hI9jK0lM1n2O3p4Q5r6S7t8U9v0', 'admin')
ON CONFLICT (email) DO NOTHING;
