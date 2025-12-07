/**
 * Tenant Middleware
 * Ensures all requests are scoped to the user's organization
 * Checks subscription status and enforces plan limits
 */

const db = require('../config/database');

// Plan feature limits
const planLimits = {
    trial: {
        maxUsers: 2,
        maxQuotesPerMonth: 20,
        adminPdf: true,
        whiteLabel: false,
        apiAccess: false
    },
    professional: {
        maxUsers: 3,
        maxQuotesPerMonth: 100,
        adminPdf: true,
        whiteLabel: false,
        apiAccess: false
    },
    business: {
        maxUsers: 10,
        maxQuotesPerMonth: -1, // unlimited
        adminPdf: true,
        whiteLabel: true,
        apiAccess: false
    },
    enterprise: {
        maxUsers: -1, // unlimited
        maxQuotesPerMonth: -1,
        adminPdf: true,
        whiteLabel: true,
        apiAccess: true
    }
};

/**
 * Load organization context for authenticated requests
 */
const loadOrganization = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.organization_id) {
        return res.status(403).json({
            error: 'Organization required',
            message: 'Your account is not associated with an organization. Please contact support.'
        });
    }

    try {
        const result = await db.query(
            'SELECT * FROM organizations WHERE id = $1',
            [req.user.organization_id]
        );

        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'Organization not found' });
        }

        const org = result.rows[0];
        req.organization = org;
        req.planLimits = planLimits[org.plan] || planLimits.trial;

        next();
    } catch (error) {
        console.error('Load organization error:', error.message);
        res.status(500).json({ error: 'Failed to load organization' });
    }
};

/**
 * Check if subscription is active
 * Allows access during trial or active subscription
 * Returns 402 Payment Required if subscription is inactive
 */
const requireActiveSubscription = async (req, res, next) => {
    if (!req.organization) {
        return res.status(403).json({ error: 'Organization required' });
    }

    const { subscription_status, trial_ends_at } = req.organization;

    // Check trial status
    if (subscription_status === 'trial') {
        if (new Date() > new Date(trial_ends_at)) {
            return res.status(402).json({
                error: 'Trial expired',
                code: 'TRIAL_EXPIRED',
                message: 'Your trial has expired. Please subscribe to continue.'
            });
        }
        return next();
    }

    // Check subscription status
    if (subscription_status === 'active' || subscription_status === 'grace_period') {
        return next();
    }

    // Subscription is cancelled or past due
    return res.status(402).json({
        error: 'Subscription inactive',
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'Your subscription is inactive. Please update your payment method.'
    });
};

/**
 * Check if user can create more quotes this month
 */
const checkQuoteLimit = async (req, res, next) => {
    if (!req.organization || !req.planLimits) {
        return next();
    }

    const limit = req.planLimits.maxQuotesPerMonth;
    if (limit === -1) return next(); // unlimited

    try {
        const result = await db.query(
            `SELECT COUNT(*) FROM quotes 
             WHERE organization_id = $1 
             AND created_at >= date_trunc('month', CURRENT_DATE)`,
            [req.organization.id]
        );

        const count = parseInt(result.rows[0].count);
        if (count >= limit) {
            return res.status(403).json({
                error: 'Quote limit reached',
                code: 'QUOTE_LIMIT_REACHED',
                message: `You've reached your monthly limit of ${limit} quotes. Upgrade to create more.`,
                current: count,
                limit: limit
            });
        }

        next();
    } catch (error) {
        console.error('Check quote limit error:', error.message);
        next(); // Allow on error to prevent blocking
    }
};

/**
 * Check if organization can add more users
 */
const checkUserLimit = async (req, res, next) => {
    if (!req.organization || !req.planLimits) {
        return next();
    }

    const limit = req.planLimits.maxUsers;
    if (limit === -1) return next(); // unlimited

    try {
        const result = await db.query(
            'SELECT COUNT(*) FROM users WHERE organization_id = $1',
            [req.organization.id]
        );

        const count = parseInt(result.rows[0].count);
        if (count >= limit) {
            return res.status(403).json({
                error: 'User limit reached',
                code: 'USER_LIMIT_REACHED',
                message: `You've reached your limit of ${limit} users. Upgrade to add more.`,
                current: count,
                limit: limit
            });
        }

        next();
    } catch (error) {
        console.error('Check user limit error:', error.message);
        next();
    }
};

/**
 * Require admin PDF feature
 */
const requireAdminPdf = (req, res, next) => {
    if (!req.planLimits || !req.planLimits.adminPdf) {
        return res.status(403).json({
            error: 'Feature not available',
            code: 'FEATURE_UNAVAILABLE',
            message: 'Admin PDF is not available on your plan. Please upgrade.'
        });
    }
    next();
};

module.exports = {
    loadOrganization,
    requireActiveSubscription,
    checkQuoteLimit,
    checkUserLimit,
    requireAdminPdf,
    planLimits
};
