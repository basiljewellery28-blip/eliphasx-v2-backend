const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch fresh user data including organization_id
        const result = await db.query(
            'SELECT id, email, role, organization_id, is_org_owner FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'User not found' });
        }

        req.user = result.rows[0];
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
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

module.exports = { authenticateToken, requireAdmin, requireOrgOwner };
