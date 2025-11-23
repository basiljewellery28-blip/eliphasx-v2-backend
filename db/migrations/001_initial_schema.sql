-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'sales',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY,
    profile_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    company VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    pricing_template JSONB DEFAULT '{}',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
    id SERIAL PRIMARY KEY,
    quote_number VARCHAR(100) UNIQUE NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    user_id INTEGER REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'draft',
    piece_category VARCHAR(100),
    brief_id VARCHAR(100),
    
    -- Metal section
    metal_type VARCHAR(100),
    metal_weight DECIMAL(10,2),
    metal_spot_price DECIMAL(10,2),
    metal_wastage DECIMAL(5,2),
    metal_markup DECIMAL(5,2),
    
    -- CAD section
    cad_hours DECIMAL(5,2),
    cad_base_rate DECIMAL(10,2),
    cad_revisions INTEGER,
    cad_rendering_cost DECIMAL(10,2),
    cad_technical_cost DECIMAL(10,2),
    cad_markup DECIMAL(5,2),
    
    -- Other sections (simplified for MVP, can be expanded or stored in JSONB if very dynamic)
    manufacturing_technique VARCHAR(100),
    manufacturing_hours DECIMAL(5,2),
    manufacturing_base_rate DECIMAL(10,2),
    manufacturing_markup DECIMAL(5,2),
    
    -- Collection mode
    design_variations JSONB DEFAULT '[]',
    is_collection BOOLEAN DEFAULT FALSE,
    
    -- Totals
    subtotal DECIMAL(10,2),
    overhead DECIMAL(10,2),
    profit DECIMAL(10,2),
    total DECIMAL(10,2),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Metal pricing table
CREATE TABLE IF NOT EXISTS metal_prices (
    id SERIAL PRIMARY KEY,
    metal_type VARCHAR(100) UNIQUE NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    alloy_composition TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
