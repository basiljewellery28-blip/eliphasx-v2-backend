const jwt = require('jsonwebtoken');
const db = require('../config/database');

// 🛡️ SUPER ADMIN WHITELIST - Maximum Security Layer
// Only these emails can access system-level admin functions
const SUPER_ADMIN_EMAILS = [
    'ntobekom@basilx.co.za',
    'eliphasxsupport@basilx.co.za'
];

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // console.log('DEBUG: Token decoded:', decoded);

        // Fetch fresh user data including organization_id
        const result = await db.query(
            'SELECT id, email, role, organization_id, is_org_owner FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            console.error('DEBUG: User not found in DB for ID:', decoded.id);
            return res.status(403).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        // console.log('DEBUG: User fetched from DB:', user);

        if (!user.organization_id) {
            console.error('DEBUG: User has no organization_id:', user.email);
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('DEBUG: Auth error:', err.message);
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Super Admin access - requires BOTH role='admin' AND whitelisted email
const requireAdmin = (req, res, next) => {
    const userEmail = req.user.email?.toLowerCase();
    const isWhitelisted = SUPER_ADMIN_EMAILS.some(e => e.toLowerCase() === userEmail);

    if (req.user.role !== 'admin' || !isWhitelisted) {
        console.warn(`🚫 Blocked admin access attempt: ${req.user.email} (Role: ${req.user.role})`);
        return res.status(403).json({ error: 'Super Admin access required' });
    }
    next();
};

// Require organization owner (can manage billing, add users)
const requireOrgOwner = (req, res, next) => {
    if (!req.user.is_org_owner && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Organization owner access required' });
    }
    next();
};

// Helper to check if user is super admin (for frontend checks)
const isSuperAdmin = (email) => {
    return SUPER_ADMIN_EMAILS.some(e => e.toLowerCase() === email?.toLowerCase());
};

module.exports = { authenticateToken, requireAdmin, requireOrgOwner, isSuperAdmin, SUPER_ADMIN_EMAILS };

