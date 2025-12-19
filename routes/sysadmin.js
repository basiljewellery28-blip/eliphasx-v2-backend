const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireAdmin, SUPER_ADMIN_EMAILS } = require('../middleware/auth');
const { getAuditLogs } = require('../services/auditService');

/**
 * 🛡️ SUPER ADMIN ROUTES
 * System-level oversight for platform administrators only
 * Protected by whitelist: ntobekom@basilx.co.za, eliphasxsupport@basilx.co.za
 */

// GET /api/sysadmin/stats - System overview statistics
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Get counts from all key tables - with fallbacks for missing columns
        let orgsResult = { rows: [] };
        let usersResult = { rows: [{ count: 0 }] };
        let quotesResult = { rows: [{ total: 0, completed: 0 }] };
        let clientsResult = { rows: [{ count: 0 }] };

        // Try to get organization counts (may fail if status column doesn't exist)
        try {
            orgsResult = await db.query('SELECT COUNT(*) as count, COALESCE(status, subscription_status, \'active\') as status FROM organizations GROUP BY COALESCE(status, subscription_status, \'active\')');
        } catch (e) {
            console.warn('Organizations query failed, trying simpler query:', e.message);
            try {
                orgsResult = await db.query('SELECT COUNT(*) as count, \'active\' as status FROM organizations');
            } catch (e2) {
                console.warn('Organizations table may not exist:', e2.message);
            }
        }

        // Get user count
        try {
            usersResult = await db.query('SELECT COUNT(*) as count FROM users');
        } catch (e) {
            console.warn('Users query failed:', e.message);
        }

        // Get quote counts
        try {
            quotesResult = await db.query('SELECT COUNT(*) as total, COUNT(CASE WHEN status = \'completed\' THEN 1 END) as completed FROM quotes');
        } catch (e) {
            console.warn('Quotes query failed:', e.message);
        }

        // Get client count
        try {
            clientsResult = await db.query('SELECT COUNT(*) as count FROM clients');
        } catch (e) {
            console.warn('Clients query failed:', e.message);
        }

        // Get recent activity (last 24 hours) - handle if audit_logs doesn't exist
        let recentActivity = { rows: [] };
        try {
            recentActivity = await db.query(`
                SELECT action, COUNT(*) as count 
                FROM audit_logs 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                GROUP BY action
            `);
        } catch (auditError) {
            console.warn('Audit logs table may not exist yet:', auditError.message);
        }

        // Parse organization stats
        const orgStats = { total: 0, active: 0, trial: 0, suspended: 0 };
        orgsResult.rows.forEach(row => {
            orgStats.total += parseInt(row.count);
            const status = row.status || 'active';
            orgStats[status] = (orgStats[status] || 0) + parseInt(row.count);
        });

        res.json({
            overview: {
                organizations: orgStats,
                users: parseInt(usersResult.rows[0]?.count || 0),
                quotes: {
                    total: parseInt(quotesResult.rows[0]?.total || 0),
                    completed: parseInt(quotesResult.rows[0]?.completed || 0)
                },
                clients: parseInt(clientsResult.rows[0]?.count || 0)
            },
            recentActivity: recentActivity.rows,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch system stats', details: error.message });
    }
});

// GET /api/sysadmin/audit-logs - View audit trail
router.get('/audit-logs', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userId, action, limit = 50, offset = 0 } = req.query;

        const logs = await getAuditLogs({
            userId: userId ? parseInt(userId) : null,
            action,
            limit: Math.min(parseInt(limit), 200), // Cap at 200
            offset: parseInt(offset)
        });

        res.json({ logs, count: logs.length });
    } catch (error) {
        console.error('Audit logs error:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// GET /api/sysadmin/organizations - List all organizations (tenants)
router.get('/organizations', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                o.*,
                COUNT(DISTINCT u.id) as user_count,
                COUNT(DISTINCT q.id) as quote_count,
                COUNT(DISTINCT c.id) as client_count
            FROM organizations o
            LEFT JOIN users u ON u.organization_id = o.id
            LEFT JOIN quotes q ON q.organization_id = o.id
            LEFT JOIN clients c ON c.organization_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `);

        res.json({ organizations: result.rows });
    } catch (error) {
        console.error('Organizations error:', error);
        res.status(500).json({ error: 'Failed to fetch organizations' });
    }
});

// PATCH /api/sysadmin/organizations/:id/status - Suspend/Activate organization
router.patch('/organizations/:id/status', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body; // 'active', 'suspended', 'trial'

        if (!['active', 'suspended', 'trial'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        await db.query(
            'UPDATE organizations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, id]
        );

        res.json({ message: `Organization ${status === 'suspended' ? 'suspended' : 'activated'} successfully` });
    } catch (error) {
        console.error('Status update error:', error);
        res.status(500).json({ error: 'Failed to update organization status' });
    }
});

// GET /api/sysadmin/users - List all users across all organizations
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                u.id, u.email, u.role, u.is_org_owner, u.created_at,
                o.name as organization_name, o.status as org_status
            FROM users u
            LEFT JOIN organizations o ON u.organization_id = o.id
            ORDER BY u.created_at DESC
            LIMIT 100
        `);

        res.json({ users: result.rows });
    } catch (error) {
        console.error('Users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /api/sysadmin/health - Detailed system health check
router.get('/health', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Check database connection
        const dbCheck = await db.query('SELECT NOW() as time');

        // Get table sizes
        const tableSizes = await db.query(`
            SELECT relname as table_name, 
                   n_live_tup as row_count
            FROM pg_stat_user_tables
            ORDER BY n_live_tup DESC
            LIMIT 10
        `);

        res.json({
            status: 'healthy',
            database: {
                connected: true,
                serverTime: dbCheck.rows[0].time,
                tables: tableSizes.rows
            },
            server: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                nodeVersion: process.version
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// ======= BACKUP MANAGEMENT =======
const backupService = require('../services/backupService');

// GET /api/sysadmin/backups - List recent backups
router.get('/backups', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!backupService.isS3Configured()) {
            return res.status(503).json({
                error: 'S3 not configured',
                message: 'AWS S3 credentials are not set in environment variables'
            });
        }

        const backups = await backupService.listBackups();
        res.json({ backups });
    } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ error: 'Failed to list backups', details: error.message });
    }
});

// POST /api/sysadmin/backups - Create a new backup
router.post('/backups', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!backupService.isS3Configured()) {
            return res.status(503).json({
                error: 'S3 not configured',
                message: 'AWS S3 credentials are not set in environment variables'
            });
        }

        const result = await backupService.createDatabaseBackup();
        res.json({
            message: 'Backup created successfully',
            backup: result
        });
    } catch (error) {
        console.error('Create backup error:', error);
        res.status(500).json({ error: 'Failed to create backup', details: error.message });
    }
});

// GET /api/sysadmin/backups/status - Check if S3 is configured
router.get('/backups/status', authenticateToken, requireAdmin, (req, res) => {
    res.json({
        configured: backupService.isS3Configured(),
        region: process.env.AWS_REGION || 'not set',
        bucket: process.env.AWS_S3_BUCKET || 'not set'
    });
});

module.exports = router;
