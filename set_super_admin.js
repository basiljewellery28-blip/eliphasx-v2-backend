/**
 * Utility script to set Super Admin role for whitelisted users
 * Run with: node set_super_admin.js
 */

require('dotenv').config();
const db = require('./config/database');

const SUPER_ADMIN_EMAILS = [
    'ntobekom@basilx.co.za',
    'eliphasxsupport@basilx.co.za'
];

async function setUserAsAdmin(email) {
    try {
        // Find user by email (case insensitive)
        const findResult = await db.query(
            'SELECT id, email, role FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
        );

        if (findResult.rows.length === 0) {
            console.log(`❌ User not found: ${email}`);
            return false;
        }

        const user = findResult.rows[0];
        console.log(`Found user: ${user.email} (current role: ${user.role})`);

        if (user.role === 'admin') {
            console.log(`✅ User ${user.email} is already an admin!`);
            return true;
        }

        // Update role to admin
        await db.query(
            'UPDATE users SET role = $1 WHERE id = $2',
            ['admin', user.id]
        );

        console.log(`✅ Updated ${user.email} to admin role!`);
        return true;
    } catch (error) {
        console.error(`Error updating user: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🛡️ Super Admin Setup Script\n');
    console.log('Checking and setting admin role for whitelisted emails...\n');

    for (const email of SUPER_ADMIN_EMAILS) {
        await setUserAsAdmin(email);
    }

    // Also list all current users with their roles
    console.log('\n📋 All users in database:');
    const allUsers = await db.query('SELECT email, role, is_org_owner FROM users ORDER BY created_at DESC');
    allUsers.rows.forEach(u => {
        console.log(`  - ${u.email} | Role: ${u.role} | Org Owner: ${u.is_org_owner}`);
    });

    process.exit(0);
}

main();
