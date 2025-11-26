const db = require('../config/database');

async function runMigration() {
    console.log('Starting migration...');
    try {
        // Check if column exists
        const checkQuery = `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='quotes' AND column_name='cad_markup_image';
        `;
        const checkResult = await db.query(checkQuery);

        if (checkResult.rows.length === 0) {
            console.log('Adding cad_markup_image column...');
            await db.query(`
                ALTER TABLE quotes ADD COLUMN cad_markup_image TEXT;
                COMMENT ON COLUMN quotes.cad_markup_image IS 'Base64-encoded PNG image data containing CAD markup annotations';
            `);
            console.log('Column added successfully.');
        } else {
            console.log('Column cad_markup_image already exists.');
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
