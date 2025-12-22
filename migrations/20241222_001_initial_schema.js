/**
 * Initial Schema Migration
 * Captures the existing database schema for version control
 * 
 * Run: npx knex migrate:latest
 * Rollback: npx knex migrate:rollback
 */

exports.up = function (knex) {
    return knex.schema
        // Organizations table
        .createTableIfNotExists('organizations', (table) => {
            table.increments('id').primary();
            table.string('name').notNullable();
            table.string('slug').unique().notNullable();
            table.string('plan').defaultTo('trial');
            table.string('subscription_status').defaultTo('trialing');
            table.timestamp('trial_ends_at');
            table.string('paystack_customer_id');
            table.string('paystack_subscription_id');
            table.jsonb('branding').defaultTo('{}');
            table.timestamps(true, true);
        })

        // Users table
        .createTableIfNotExists('users', (table) => {
            table.increments('id').primary();
            table.string('email').unique().notNullable();
            table.string('password_hash').notNullable();
            table.string('first_name');
            table.string('last_name');
            table.string('phone');
            table.string('job_title');
            table.string('role').defaultTo('sales');
            table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
            table.boolean('is_org_owner').defaultTo(false);
            table.integer('failed_login_attempts').defaultTo(0);
            table.timestamp('locked_until');
            table.timestamps(true, true);
        })

        // Clients table
        .createTableIfNotExists('clients', (table) => {
            table.increments('id').primary();
            table.string('name').notNullable();
            table.string('company');
            table.string('email');
            table.string('phone');
            table.string('id_number');
            table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
            table.integer('created_by').references('id').inTable('users');
            table.boolean('is_verified').defaultTo(false);
            table.integer('verified_by').references('id').inTable('users');
            table.timestamps(true, true);
        })

        // Quotes table
        .createTableIfNotExists('quotes', (table) => {
            table.increments('id').primary();
            table.string('quote_number').unique().notNullable();
            table.integer('client_id').references('id').inTable('clients');
            table.integer('user_id').references('id').inTable('users');
            table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
            table.string('status').defaultTo('draft');
            table.jsonb('metal_details').defaultTo('{}');
            table.jsonb('cad_details').defaultTo('{}');
            table.jsonb('stone_details').defaultTo('{}');
            table.jsonb('production_details').defaultTo('{}');
            table.jsonb('labor_details').defaultTo('{}');
            table.jsonb('markup_details').defaultTo('{}');
            table.jsonb('totals').defaultTo('{}');
            table.text('notes');
            table.timestamps(true, true);
        })

        // Subscriptions table
        .createTableIfNotExists('subscriptions', (table) => {
            table.increments('id').primary();
            table.integer('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
            table.string('plan').notNullable();
            table.string('status').defaultTo('active');
            table.string('paystack_subscription_id');
            table.string('paystack_plan_code');
            table.decimal('amount', 10, 2);
            table.string('currency').defaultTo('ZAR');
            table.timestamp('current_period_start');
            table.timestamp('current_period_end');
            table.timestamp('cancelled_at');
            table.timestamps(true, true);
        })

        // Audit logs table
        .createTableIfNotExists('audit_logs', (table) => {
            table.increments('id').primary();
            table.integer('user_id').references('id').inTable('users');
            table.integer('organization_id').references('id').inTable('organizations');
            table.string('action').notNullable();
            table.jsonb('details').defaultTo('{}');
            table.string('ip_address');
            table.string('user_agent');
            table.timestamp('created_at').defaultTo(knex.fn.now());
        });
};

exports.down = function (knex) {
    return knex.schema
        .dropTableIfExists('audit_logs')
        .dropTableIfExists('subscriptions')
        .dropTableIfExists('quotes')
        .dropTableIfExists('clients')
        .dropTableIfExists('users')
        .dropTableIfExists('organizations');
};
