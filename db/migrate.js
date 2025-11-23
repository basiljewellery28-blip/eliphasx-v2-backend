const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function runMigrations() {
    try {
        console.log('Running ELIPHASx database migrations...');

        // Read and execute the schema SQL
        const fs = require('fs');
        const path = require('path');
        const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

        await pool.query(schemaSQL);
        console.log('✅ Database schema created successfully');

        // Seed initial data
        const seedSQL = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
        await pool.query(seedSQL);
        console.log('✅ Initial data seeded successfully');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigrations();
