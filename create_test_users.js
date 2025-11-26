const db = require('./config/database');
const bcrypt = require('bcrypt');

const createUsers = async () => {
    try {
        const adminEmail = 'admin_test@eliphasx.com';
        const adminPass = 'Admin123!';
        const salesEmail = 'sales_test@eliphasx.com';
        const salesPass = 'Sales123!';

        const hashedAdminPass = await bcrypt.hash(adminPass, 10);
        const hashedSalesPass = await bcrypt.hash(salesPass, 10);

        console.log('Creating Admin User...');
        // Check if exists first to avoid duplicate error if run multiple times
        const adminCheck = await db.query('SELECT * FROM users WHERE email = $1', [adminEmail]);
        if (adminCheck.rows.length === 0) {
            await db.query(
                'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
                [adminEmail, hashedAdminPass, 'admin']
            );
            console.log(`Admin created: ${adminEmail}`);
        } else {
            console.log(`Admin user ${adminEmail} already exists.`);
        }

        console.log('Creating Sales User...');
        const salesCheck = await db.query('SELECT * FROM users WHERE email = $1', [salesEmail]);
        if (salesCheck.rows.length === 0) {
            await db.query(
                'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
                [salesEmail, hashedSalesPass, 'sales']
            );
            console.log(`Sales user created: ${salesEmail}`);
        } else {
            console.log(`Sales user ${salesEmail} already exists.`);
        }

        console.log('Done!');
        process.exit(0);
    } catch (error) {
        console.error('Error creating users:', error);
        process.exit(1);
    }
};

createUsers();
