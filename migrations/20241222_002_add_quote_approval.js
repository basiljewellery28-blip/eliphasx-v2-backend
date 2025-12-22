/**
 * Add Quote Approval Columns
 * Supports the Quote Approval Workflow feature
 * 
 * Run: npx knex migrate:latest
 * Rollback: npx knex migrate:rollback
 */

exports.up = function (knex) {
    return knex.schema.alterTable('quotes', (table) => {
        table.boolean('requires_approval').defaultTo(false);
        table.integer('approved_by').references('id').inTable('users');
        table.timestamp('approved_at');
        table.text('approval_notes');
        table.integer('submitted_for_approval_by').references('id').inTable('users');
        table.timestamp('submitted_for_approval_at');
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('quotes', (table) => {
        table.dropColumn('requires_approval');
        table.dropColumn('approved_by');
        table.dropColumn('approved_at');
        table.dropColumn('approval_notes');
        table.dropColumn('submitted_for_approval_by');
        table.dropColumn('submitted_for_approval_at');
    });
};
