const db = require('../config/database');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
    console.log('Starting migrations...');
    try {
        const migrationsPath = path.join(__dirname, '../migrations');
        const files = fs.readdirSync(migrationsPath).filter(f => f.endsWith('.sql'));

        console.log(`Found ${files.length} migration file(s)`);

        for (const file of files) {
            console.log(`Running migration: ${file}`);
            const sql = fs.readFileSync(path.join(migrationsPath, file), 'utf8');
            await db.query(sql);
            console.log(`✓ Completed: ${file}`);
        }

        console.log('All migrations completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigrations();
