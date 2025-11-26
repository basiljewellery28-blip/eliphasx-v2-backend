const db = require('../../config/database');

const migrate = async () => {
    try {
        console.log('Adding is_verified column to clients table...');

        // Check if column exists
        const check = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='clients' AND column_name='is_verified'
        `);

        if (check.rows.length === 0) {
            await db.query(`
                ALTER TABLE clients 
                ADD COLUMN is_verified BOOLEAN DEFAULT FALSE
            `);
            console.log('Column added successfully.');
        } else {
            console.log('Column already exists.');
        }

        // Set existing clients to verified (optional, but good for legacy data)
        await db.query('UPDATE clients SET is_verified = TRUE WHERE is_verified IS NULL');

        console.log('Migration complete.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrate();
