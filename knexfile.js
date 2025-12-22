/**
 * Knex.js Configuration
 * Database migration and seed settings for development and production
 */

require('dotenv').config();

module.exports = {
    development: {
        client: 'pg',
        connection: process.env.DATABASE_URL || {
            host: 'localhost',
            port: 5432,
            database: 'eliphasx_dev',
            user: 'postgres',
            password: 'postgres'
        },
        pool: {
            min: 2,
            max: 10
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: './migrations'
        },
        seeds: {
            directory: './seeds'
        }
    },

    production: {
        client: 'pg',
        connection: process.env.DATABASE_URL,
        pool: {
            min: 2,
            max: 10
        },
        migrations: {
            tableName: 'knex_migrations',
            directory: './migrations'
        },
        seeds: {
            directory: './seeds'
        }
    }
};
