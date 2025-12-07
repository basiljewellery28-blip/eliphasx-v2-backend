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
        const { email, role } = req.body;
        const org = req.organization;

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
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        // In production: Send invitation email with signup link
        // For now: Return invitation code/link
        const inviteCode = require('crypto').randomBytes(16).toString('hex');

        res.json({
            message: 'Invitation created',
            invitation: {
                email: xss(email),
                role: role || 'sales',
                inviteCode: inviteCode,
                signupUrl: `${process.env.FRONTEND_URL}/register?invite=${inviteCode}&org=${org.slug}`
            }
        });
    } catch (error) {
        console.error('Invite user error:', error.message);
        res.status(500).json({ error: 'Failed to create invitation' });
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
