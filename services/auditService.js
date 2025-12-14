const db = require('../config/database');

/**
 * 🛡️ Audit Logging Service
 * Records all critical system actions for security and debugging
 */

const AuditAction = {
    // Authentication
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PASSWORD_RESET: 'PASSWORD_RESET',

    // Quotes
    CREATE_QUOTE: 'CREATE_QUOTE',
    UPDATE_QUOTE: 'UPDATE_QUOTE',
    DELETE_QUOTE: 'DELETE_QUOTE',
    DOWNLOAD_PDF: 'DOWNLOAD_PDF',

    // Clients
    CREATE_CLIENT: 'CREATE_CLIENT',
    UPDATE_CLIENT: 'UPDATE_CLIENT',
    DELETE_CLIENT: 'DELETE_CLIENT',

    // Admin Actions
    UPDATE_METAL_PRICES: 'UPDATE_METAL_PRICES',
    UPDATE_STONE_PRICES: 'UPDATE_STONE_PRICES',

    // Organization
    INVITE_USER: 'INVITE_USER',
    REMOVE_USER: 'REMOVE_USER',
    UPDATE_BRANDING: 'UPDATE_BRANDING',
    SUBSCRIPTION_CHANGE: 'SUBSCRIPTION_CHANGE'
};

/**
 * Log an audit event
 * @param {Object} params
 * @param {number} params.userId - User performing the action (null for system)
 * @param {number} params.organizationId - Organization context (optional)
 * @param {string} params.action - Action type from AuditAction
 * @param {Object} params.details - Additional JSON details
 * @param {Object} params.req - Express request object (for IP/UserAgent)
 */
const logAudit = async ({ userId, organizationId, action, details = {}, req = null }) => {
    try {
        const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || null;
        const userAgent = req?.headers?.['user-agent'] || null;

        await db.query(
            `INSERT INTO audit_logs (user_id, organization_id, action, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userId, organizationId, action, JSON.stringify(details), ipAddress, userAgent]
        );
    } catch (error) {
        // Don't let audit logging failures break the main flow
        console.error('⚠️ Audit log failed:', error.message);
    }
};

/**
 * Get audit logs with filtering
 * @param {Object} filters - Optional filters
 */
const getAuditLogs = async ({ userId, organizationId, action, limit = 100, offset = 0 } = {}) => {
    let query = 'SELECT al.*, u.email as user_email FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (userId) {
        params.push(userId);
        query += ` AND al.user_id = $${++paramCount}`;
    }
    if (organizationId) {
        params.push(organizationId);
        query += ` AND al.organization_id = $${++paramCount}`;
    }
    if (action) {
        params.push(action);
        query += ` AND al.action = $${++paramCount}`;
    }

    params.push(limit, offset);
    query += ` ORDER BY al.created_at DESC LIMIT $${++paramCount} OFFSET $${++paramCount}`;

    const result = await db.query(query, params);
    return result.rows;
};

module.exports = { logAudit, getAuditLogs, AuditAction };
