/**
 * Organization Routes
 * Handles organization management, user invitations, and branding
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireOrgOwner } = require('../middleware/auth');
const { loadOrganization } = require('../middleware/tenant');
const xss = require('xss');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for logo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const orgId = req.organization.id;
        const uploadDir = path.join(__dirname, '../uploads/logos', String(orgId));

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `logo${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only PNG and JPG images are allowed'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});

/**
 * GET /organizations/current
 * Get current organization details
 */
router.get('/current', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const org = req.organization;

        // Get user count
        const userCount = await db.query(
            'SELECT COUNT(*) FROM users WHERE organization_id = $1',
            [org.id]
        );

        // Get quote count this month
        const quoteCount = await db.query(
            `SELECT COUNT(*) FROM quotes 
             WHERE organization_id = $1 
             AND created_at >= date_trunc('month', CURRENT_DATE)`,
            [org.id]
        );

        res.json({
            organization: {
                id: org.id,
                name: org.name,
                slug: org.slug,
                plan: org.plan,
                status: org.subscription_status,
                trialEndsAt: org.trial_ends_at,
                settings: org.settings
            },
            usage: {
                users: parseInt(userCount.rows[0].count),
                quotesThisMonth: parseInt(quoteCount.rows[0].count)
            },
            limits: req.planLimits
        });
    } catch (error) {
        console.error('Get organization error:', error.message);
        res.status(500).json({ error: 'Failed to fetch organization' });
    }
});

/**
 * GET /organizations/dashboard-stats
 * Get comprehensive dashboard statistics for organization admins
 */
router.get('/dashboard-stats', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const orgId = req.organization.id;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Quote statistics
        const quoteStats = await db.query(`
            SELECT 
                COUNT(*) as total_quotes,
                COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_quotes,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_quotes,
                COUNT(CASE WHEN created_at >= $2 THEN 1 END) as quotes_this_month,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= $2 THEN total ELSE 0 END), 0) as revenue_this_month
            FROM quotes WHERE organization_id = $1
        `, [orgId, startOfMonth.toISOString()]);

        // Client statistics
        const clientStats = await db.query(`
            SELECT 
                COUNT(*) as total_clients,
                COUNT(CASE WHEN is_verified = true THEN 1 END) as verified_clients,
                COUNT(CASE WHEN is_verified = false THEN 1 END) as pending_clients,
                COUNT(CASE WHEN created_at >= $2 THEN 1 END) as new_clients_this_month
            FROM clients WHERE organization_id = $1
        `, [orgId, startOfMonth.toISOString()]);

        // Team member count
        const teamStats = await db.query(`
            SELECT COUNT(*) as team_members
            FROM users WHERE organization_id = $1
        `, [orgId]);

        // Monthly quote trend (last 6 months)
        const monthlyTrend = await db.query(`
            SELECT 
                DATE_TRUNC('month', created_at) as month,
                COUNT(*) as quote_count,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) as revenue
            FROM quotes 
            WHERE organization_id = $1 
                AND created_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY month ASC
        `, [orgId]);

        // Recent activity (last 10 items)
        const recentQuotes = await db.query(`
            SELECT 
                'quote' as type,
                q.id,
                q.quote_number as title,
                q.status,
                q.total as amount,
                q.created_at,
                u.email as created_by_email,
                c.name as client_name
            FROM quotes q
            LEFT JOIN users u ON q.user_id = u.id
            LEFT JOIN clients c ON q.client_id = c.id
            WHERE q.organization_id = $1
            ORDER BY q.created_at DESC
            LIMIT 5
        `, [orgId]);

        const recentClients = await db.query(`
            SELECT 
                'client' as type,
                c.id,
                c.name as title,
                c.company,
                c.is_verified,
                c.created_at,
                u.email as created_by_email
            FROM clients c
            LEFT JOIN users u ON c.created_by = u.id
            WHERE c.organization_id = $1
            ORDER BY c.created_at DESC
            LIMIT 5
        `, [orgId]);

        // Combine and sort recent activity
        const recentActivity = [
            ...recentQuotes.rows.map(q => ({
                type: 'quote',
                id: q.id,
                title: `Quote ${q.quote_number}`,
                subtitle: `${q.client_name || 'Unknown'} - R${parseFloat(q.amount || 0).toFixed(2)}`,
                status: q.status,
                createdAt: q.created_at,
                createdBy: q.created_by_email
            })),
            ...recentClients.rows.map(c => ({
                type: 'client',
                id: c.id,
                title: c.title,
                subtitle: c.company || 'No company',
                status: c.is_verified ? 'verified' : 'pending',
                createdAt: c.created_at,
                createdBy: c.created_by_email
            }))
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);

        res.json({
            quotes: {
                total: parseInt(quoteStats.rows[0].total_quotes) || 0,
                draft: parseInt(quoteStats.rows[0].draft_quotes) || 0,
                completed: parseInt(quoteStats.rows[0].completed_quotes) || 0,
                thisMonth: parseInt(quoteStats.rows[0].quotes_this_month) || 0
            },
            revenue: {
                total: parseFloat(quoteStats.rows[0].total_revenue) || 0,
                thisMonth: parseFloat(quoteStats.rows[0].revenue_this_month) || 0
            },
            clients: {
                total: parseInt(clientStats.rows[0].total_clients) || 0,
                verified: parseInt(clientStats.rows[0].verified_clients) || 0,
                pending: parseInt(clientStats.rows[0].pending_clients) || 0,
                newThisMonth: parseInt(clientStats.rows[0].new_clients_this_month) || 0
            },
            team: {
                members: parseInt(teamStats.rows[0].team_members) || 0
            },
            monthlyTrend: monthlyTrend.rows.map(row => ({
                month: row.month,
                quoteCount: parseInt(row.quote_count),
                revenue: parseFloat(row.revenue)
            })),
            recentActivity
        });
    } catch (error) {
        console.error('Dashboard stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});


/**
 * PUT /organizations/current
 * Update organization details
 */
router.put('/current', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const { name, settings } = req.body;
        const org = req.organization;

        const result = await db.query(
            `UPDATE organizations SET 
                name = COALESCE($1, name),
                settings = COALESCE($2::jsonb, settings),
                updated_at = NOW()
             WHERE id = $3 RETURNING *`,
            [xss(name), settings ? JSON.stringify(settings) : null, org.id]
        );

        res.json({ organization: result.rows[0] });
    } catch (error) {
        console.error('Update organization error:', error.message);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

/**
 * GET /organizations/users
 * List users in organization
 */
router.get('/users', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, email, role, is_org_owner, created_at 
             FROM users WHERE organization_id = $1 ORDER BY created_at`,
            [req.organization.id]
        );

        res.json({ users: result.rows });
    } catch (error) {
        console.error('List users error:', error.message);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * POST /organizations/invite
 * Invite a new user to organization
 */
router.post('/invite', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const { email } = req.body;
        const org = req.organization;
        const inviter = req.user;

        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return res.status(400).json({ error: 'Please provide a valid email address' });
        }

        // Check user limit
        const userCount = await db.query(
            'SELECT COUNT(*) FROM users WHERE organization_id = $1',
            [org.id]
        );

        const count = parseInt(userCount.rows[0].count);
        const limit = req.planLimits.maxUsers;

        if (limit !== -1 && count >= limit) {
            return res.status(403).json({
                error: 'User limit reached',
                message: `Your plan allows ${limit} users. Upgrade to add more.`
            });
        }

        // Check if user already exists
        const existing = await db.query('SELECT * FROM users WHERE email = $1', [xss(email)]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'A user with this email already exists' });
        }

        // Check if there's already a pending invitation
        const existingInvite = await db.query(
            'SELECT * FROM invitations WHERE email = $1 AND organization_id = $2 AND accepted_at IS NULL AND expires_at > NOW()',
            [xss(email), org.id]
        );
        if (existingInvite.rows.length > 0) {
            return res.status(400).json({ error: 'An invitation has already been sent to this email' });
        }

        // Generate invite token and expiry (1 day)
        const inviteToken = require('crypto').randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day

        // Store invitation in database
        await db.query(
            `INSERT INTO invitations (organization_id, email, role, invite_token, invited_by, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [org.id, xss(email), 'sales', inviteToken, inviter.id, expiresAt]
        );

        const inviteUrl = `${process.env.FRONTEND_URL}/accept-invite/${inviteToken}`;

        // Get inviter's name
        const inviterResult = await db.query(
            'SELECT first_name, last_name, email FROM users WHERE id = $1',
            [inviter.id]
        );
        const inviterData = inviterResult.rows[0];
        const inviterName = inviterData.first_name && inviterData.last_name
            ? `${inviterData.first_name} ${inviterData.last_name}`
            : inviterData.email;

        // Send invitation email
        const EmailService = require('../services/emailService');
        await EmailService.sendTeamInvite({
            email: xss(email),
            inviterName: inviterName,
            inviterEmail: inviterData.email,
            organizationName: org.name,
            inviteUrl: inviteUrl,
            expiresAt: expiresAt.toISOString()
        });

        res.json({
            message: 'Invitation sent successfully',
            invitation: {
                email: xss(email),
                role: 'sales',
                expiresAt: expiresAt.toISOString()
            }
        });
    } catch (error) {
        console.error('Invite user error:', error.message);
        res.status(500).json({ error: 'Failed to send invitation' });
    }
});

/**
 * POST /organizations/branding/logo
 * Upload organization logo
 */
router.post('/branding/logo', authenticateToken, loadOrganization, requireOrgOwner, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const org = req.organization;
        const logoUrl = `/uploads/logos/${org.id}/${req.file.filename}`;

        // Update settings with logo URL
        const currentSettings = org.settings || {};
        const branding = currentSettings.branding || {};
        branding.logoUrl = logoUrl;
        currentSettings.branding = branding;

        await db.query(
            'UPDATE organizations SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(currentSettings), org.id]
        );

        res.json({
            message: 'Logo uploaded successfully',
            logoUrl: logoUrl
        });
    } catch (error) {
        console.error('Logo upload error:', error.message);
        res.status(500).json({ error: 'Failed to upload logo' });
    }
});

/**
 * PUT /organizations/branding
 * Update organization branding settings
 */
router.put('/branding', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const { headerText, tagline, footerText, footerValidityText } = req.body;
        const org = req.organization;

        // Get current settings and update branding
        const currentSettings = org.settings || {};
        const branding = currentSettings.branding || {};

        if (headerText !== undefined) branding.headerText = xss(headerText);
        if (tagline !== undefined) branding.tagline = xss(tagline);
        if (footerText !== undefined) branding.footerText = xss(footerText);
        if (footerValidityText !== undefined) branding.footerValidityText = xss(footerValidityText);

        currentSettings.branding = branding;

        const result = await db.query(
            'UPDATE organizations SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *',
            [JSON.stringify(currentSettings), org.id]
        );

        res.json({
            message: 'Branding updated successfully',
            branding: result.rows[0].settings?.branding || {}
        });
    } catch (error) {
        console.error('Update branding error:', error.message);
        res.status(500).json({ error: 'Failed to update branding' });
    }
});

/**
 * GET /organizations/branding
 * Get organization branding settings
 */
router.get('/branding', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const branding = req.organization.settings?.branding || {};
        res.json({ branding });
    } catch (error) {
        console.error('Get branding error:', error.message);
        res.status(500).json({ error: 'Failed to fetch branding' });
    }
});

/**
 * DELETE /organizations/branding/logo
 * Remove organization logo
 */
router.delete('/branding/logo', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const org = req.organization;
        const branding = org.settings?.branding || {};

        if (branding.logoUrl) {
            // Delete the file
            const logoPath = path.join(__dirname, '..', branding.logoUrl);
            if (fs.existsSync(logoPath)) {
                fs.unlinkSync(logoPath);
            }

            // Remove from settings
            delete branding.logoUrl;
            const currentSettings = org.settings || {};
            currentSettings.branding = branding;

            await db.query(
                'UPDATE organizations SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2',
                [JSON.stringify(currentSettings), org.id]
            );
        }

        res.json({ message: 'Logo removed successfully' });
    } catch (error) {
        console.error('Delete logo error:', error.message);
        res.status(500).json({ error: 'Failed to remove logo' });
    }
});

module.exports = router;
