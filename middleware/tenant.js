/**
 * Tenant Middleware
 * Ensures all requests are scoped to the user's organization
 * Checks subscription status and enforces plan limits
 */

const db = require('../config/database');
const EmailService = require('../services/emailService');

// Plan feature limits
// Plan feature limits
const planLimits = {
    trial: {
        maxUsers: 2,
        maxQuotesPerMonth: 20,
        adminPdf: false,
        whiteLabel: false,
        apiAccess: false
    },
    essential: {
        maxUsers: 1,
        maxQuotesPerMonth: 50,
        adminPdf: true,
        whiteLabel: false,
        apiAccess: false
    },
    professional: {
        maxUsers: 5,
        maxQuotesPerMonth: -1, // unlimited
        adminPdf: true,
        whiteLabel: true,
        apiAccess: false
    },
    enterprise: {
        maxUsers: -1, // unlimited
        maxQuotesPerMonth: -1, // unlimited
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
        console.error('DEBUG: loadOrganization called without req.user');
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.organization_id) {
        console.error('DEBUG: loadOrganization failed - missing organization_id for user:', req.user.email);
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

        // Send warning email at 80% (but only once per threshold crossing)
        const threshold80 = Math.floor(limit * 0.8);
        if (count === threshold80) {
            // Get org owner email for notification
            const ownerResult = await db.query(
                'SELECT email FROM users WHERE organization_id = $1 AND is_org_owner = true LIMIT 1',
                [req.organization.id]
            );
            if (ownerResult.rows.length > 0) {
                // Send async - don't block the request
                EmailService.sendQuotaWarningEmail(
                    ownerResult.rows[0].email,
                    count,
                    limit,
                    req.organization.name
                ).catch(err => console.error('Quota email failed:', err.message));
            }
        }

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
 * Note: Users with counts_towards_limit = false (e.g., accountants) are excluded
 * Includes seat addons purchased beyond plan limits
 */
const checkUserLimit = async (req, res, next) => {
    if (!req.organization || !req.planLimits) {
        return next();
    }

    let baseLimit = req.planLimits.maxUsers;
    if (baseLimit === -1) return next(); // unlimited

    try {
        // Get seat addons for this organization
        const addonResult = await db.query(
            'SELECT COALESCE(SUM(quantity), 0) as extra_seats FROM seat_addons WHERE organization_id = $1 AND status = $2',
            [req.organization.id, 'active']
        );
        const extraSeats = parseInt(addonResult.rows[0].extra_seats) || 0;
        const totalLimit = baseLimit + extraSeats;

        // Only count users that count towards the limit (excludes accountants)
        const result = await db.query(
            'SELECT COUNT(*) FROM users WHERE organization_id = $1 AND (counts_towards_limit = true OR counts_towards_limit IS NULL)',
            [req.organization.id]
        );

        const count = parseInt(result.rows[0].count);
        if (count >= totalLimit) {
            return res.status(403).json({
                error: 'User limit reached',
                code: 'USER_LIMIT_REACHED',
                message: `You've reached your limit of ${totalLimit} users${extraSeats > 0 ? ` (${baseLimit} plan + ${extraSeats} addons)` : ''}. Buy more seats or upgrade.`,
                current: count,
                limit: totalLimit,
                baseLimit: baseLimit,
                addonSeats: extraSeats
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
