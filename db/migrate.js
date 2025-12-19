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

        const fs = require('fs');
        const path = require('path');

        // Read and execute the schema SQL
        const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        await pool.query(schemaSQL);
        console.log('✅ Database schema created successfully');

        // Seed initial data
        const seedSQL = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
        await pool.query(seedSQL);
        console.log('✅ Initial data seeded successfully');

        // Run all SQL migration files in db/migrations folder
        const migrationsDir = path.join(__dirname, 'migrations');
        if (fs.existsSync(migrationsDir)) {
            const migrationFiles = fs.readdirSync(migrationsDir)
                .filter(file => file.endsWith('.sql'))
                .sort(); // Ensure they run in order

            for (const file of migrationFiles) {
                try {
                    const migrationSQL = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                    await pool.query(migrationSQL);
                    console.log(`✅ Migration applied: ${file}`);
                } catch (err) {
                    // Ignore errors for already-existing tables/indices
                    if (err.code === '42P07' || err.code === '42710') {
                        console.log(`⏭️  Migration skipped (already exists): ${file}`);
                    } else {
                        console.error(`❌ Migration failed: ${file}`, err.message);
                    }
                }
            }
        }

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigrations();
