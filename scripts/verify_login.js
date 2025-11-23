const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

async function verify() {
    try {
        console.log('Connecting to database...');
        const res = await pool.query("SELECT * FROM users WHERE email = 'admin@eliphasx.com'");
        const user = res.rows[0];

        if (!user) {
            console.log('User NOT found!');
        } else {
            console.log('User found:', user.email);
            console.log('Stored Hash:', user.password_hash);

            const password = 'ELIPHASxAdmin2024';
            const match = await bcrypt.compare(password, user.password_hash);

            console.log(`Password '${password}' match:`, match);

            if (!match) {
                console.log('Generating new hash...');
                const newHash = await bcrypt.hash(password, 10);
                console.log('New Hash:', newHash);
                await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [newHash, user.email]);
                console.log('Password updated in DB.');
            }
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

verify();
