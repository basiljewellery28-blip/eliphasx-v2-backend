/**
 * Billing Routes
 * Handles subscription management with Paystack
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireOrgOwner } = require('../middleware/auth');
const { loadOrganization, planLimits } = require('../middleware/tenant');
const crypto = require('crypto');

// Plan configurations (in kobo/cents - Paystack uses smallest currency unit)
// Plan configurations (in kobo/cents - Paystack uses smallest currency unit)
// Plan configurations (in kobo/cents - Paystack uses smallest currency unit)
const PLANS = {
    essential: {
        monthly: { amount: 89900, name: 'Essential Monthly' },
        annual: { amount: 899000, name: 'Essential Annual' }
    },
    professional: {
        monthly: { amount: 199900, name: 'Professional Monthly' },
        annual: { amount: 1999000, name: 'Professional Annual' }
    },
    enterprise: {
        monthly: { amount: 399900, name: 'Enterprise Monthly' },
        annual: { amount: 3999000, name: 'Enterprise Annual' }
    }
};

/**
 * GET /billing/status
 * Get current subscription status
 */
router.get('/status', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const org = req.organization;

        // Get active subscription if exists
        const subResult = await db.query(
            'SELECT * FROM subscriptions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1',
            [org.id]
        );

        const subscription = subResult.rows[0] || null;

        // Calculate days remaining
        let daysRemaining = null;
        if (org.subscription_status === 'trial' && org.trial_ends_at) {
            daysRemaining = Math.ceil((new Date(org.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24));
        } else if (subscription && subscription.current_period_end) {
            daysRemaining = Math.ceil((new Date(subscription.current_period_end) - new Date()) / (1000 * 60 * 60 * 24));
        }

        res.json({
            organization: {
                id: org.id,
                name: org.name,
                plan: org.plan,
                status: org.subscription_status,
                trialEndsAt: org.trial_ends_at
            },
            subscription: subscription ? {
                plan: subscription.plan,
                billingCycle: subscription.billing_cycle,
                status: subscription.status,
                currentPeriodEnd: subscription.current_period_end,
                amount: subscription.amount_cents / 100
            } : null,
            daysRemaining: daysRemaining,
            plans: PLANS
        });
    } catch (error) {
        console.error('Billing status error:', error.message);
        res.status(500).json({ error: 'Failed to fetch billing status' });
    }
});

/**
 * GET /billing/usage
 * Get current usage statistics for quota visualization
 */
router.get('/usage', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const org = req.organization;
        const limits = planLimits[org.plan] || planLimits.trial;

        // Get monthly quote count
        const quoteResult = await db.query(
            `SELECT COUNT(*) FROM quotes 
             WHERE organization_id = $1 
             AND created_at >= date_trunc('month', CURRENT_DATE)`,
            [org.id]
        );
        const quotesUsed = parseInt(quoteResult.rows[0].count);

        // Get user count (excluding accountants who don't count towards limit)
        const userResult = await db.query(
            'SELECT COUNT(*) FROM users WHERE organization_id = $1 AND (counts_towards_limit = true OR counts_towards_limit IS NULL)',
            [org.id]
        );
        const usersCount = parseInt(userResult.rows[0].count);

        // Get seat addons
        const addonResult = await db.query(
            'SELECT COALESCE(SUM(quantity), 0) as extra_seats FROM seat_addons WHERE organization_id = $1 AND status = $2',
            [org.id, 'active']
        );
        const extraSeats = parseInt(addonResult.rows[0].extra_seats) || 0;

        // Calculate totals
        const quotesLimit = limits.maxQuotesPerMonth;
        const baseUserLimit = limits.maxUsers;
        const totalUserLimit = baseUserLimit === -1 ? -1 : baseUserLimit + extraSeats;

        const quotesPercent = quotesLimit === -1 ? 0 : Math.round((quotesUsed / quotesLimit) * 100);
        const usersPercent = totalUserLimit === -1 ? 0 : Math.round((usersCount / totalUserLimit) * 100);

        // Calculate trial days remaining
        let daysRemaining = null;
        if (org.subscription_status === 'trial' && org.trial_ends_at) {
            daysRemaining = Math.max(0, Math.ceil((new Date(org.trial_ends_at) - new Date()) / (1000 * 60 * 60 * 24)));
        }

        res.json({
            plan: org.plan,
            subscription_status: org.subscription_status,
            daysRemaining,
            quotes: {
                used: quotesUsed,
                limit: quotesLimit,
                percent: Math.min(quotesPercent, 100),
                unlimited: quotesLimit === -1
            },
            users: {
                count: usersCount,
                baseLimit: baseUserLimit,
                addonSeats: extraSeats,
                totalLimit: totalUserLimit,
                percent: Math.min(usersPercent, 100),
                unlimited: totalUserLimit === -1
            },
            features: {
                whiteLabel: limits.whiteLabel,
                apiAccess: limits.apiAccess,
                adminPdf: limits.adminPdf
            },
            seatAddons: {
                available: ['professional'].includes(org.plan), // Only Professional can buy addons
                pricePerSeat: 200, // R200
                currentAddons: extraSeats
            }
        });
    } catch (error) {
        console.error('Usage stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch usage statistics' });
    }
});

/**
 * POST /billing/initialize
 * Initialize a subscription payment with Paystack
 */
router.post('/initialize', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const { plan, billingCycle } = req.body;
        const org = req.organization;

        // Validate plan
        if (!PLANS[plan] || !PLANS[plan][billingCycle]) {
            return res.status(400).json({ error: 'Invalid plan or billing cycle' });
        }

        const planConfig = PLANS[plan][billingCycle];

        // Check for downgrade constraints
        const newPlanLimits = planLimits[plan];
        if (newPlanLimits && newPlanLimits.maxUsers !== -1) {
            // Get current user count
            const userCountResult = await db.query(
                'SELECT COUNT(*) FROM users WHERE organization_id = $1',
                [org.id]
            );
            const currentUserCount = parseInt(userCountResult.rows[0].count);

            if (currentUserCount > newPlanLimits.maxUsers) {
                const excess = currentUserCount - newPlanLimits.maxUsers;
                return res.status(400).json({
                    error: 'Downgrade blocked',
                    code: 'DOWNGRADE_BLOCKED',
                    message: `You have ${currentUserCount} team members, but the ${plan} plan only supports ${newPlanLimits.maxUsers}. Please remove ${excess} member(s) before downgrading.`,
                    currentUsers: currentUserCount,
                    newLimit: newPlanLimits.maxUsers,
                    excessUsers: excess
                });
            }
        }

        // Create or get customer in Paystack
        // NOTE: In production, you would call Paystack API here
        // For now, we return initialization data for frontend

        const reference = `eliphasx_${org.id}_${Date.now()}`;

        res.json({
            message: 'Payment initialization ready',
            paystack: {
                publicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_xxxxx',
                email: req.user.email,
                amount: planConfig.amount,
                currency: 'ZAR',
                reference: reference,
                metadata: {
                    organization_id: org.id,
                    plan: plan,
                    billing_cycle: billingCycle,
                    custom_fields: [
                        { display_name: 'Organization', variable_name: 'organization', value: org.name }
                    ]
                }
            },
            plan: {
                name: planConfig.name,
                amount: planConfig.amount / 100,
                billing_cycle: billingCycle
            }
        });
    } catch (error) {
        console.error('Initialize payment error:', error.message);
        res.status(500).json({ error: 'Failed to initialize payment' });
    }
});

/**
 * POST /billing/webhook
 * Handle Paystack webhook events
 * IMPORTANT: Verify webhook signature in production
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Verify webhook signature
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || 'sk_test_xxxxx')
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            console.warn('Invalid Paystack webhook signature');
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const event = req.body;

        switch (event.event) {
            case 'charge.success':
                await handleChargeSuccess(event.data);
                break;
            case 'subscription.create':
                await handleSubscriptionCreate(event.data);
                break;
            case 'subscription.disable':
                await handleSubscriptionDisable(event.data);
                break;
            case 'charge.failed':
                await handleChargeFailed(event.data);
                break;
            default:
                console.log('Unhandled webhook event:', event.event);
        }

        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error.message);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Webhook handlers
async function handleChargeSuccess(data) {
    const { metadata, reference, amount } = data;

    if (!metadata || !metadata.organization_id) {
        console.warn('No organization_id in charge metadata');
        return;
    }

    const orgId = metadata.organization_id;
    const plan = metadata.plan || 'professional';
    const billingCycle = metadata.billing_cycle || 'monthly';

    // Calculate period end
    const periodEnd = new Date();
    if (billingCycle === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Create or update subscription
    await db.query(`
        INSERT INTO subscriptions (organization_id, plan, amount_cents, billing_cycle, status, current_period_start, current_period_end, gateway_subscription_code)
        VALUES ($1, $2, $3, $4, 'active', NOW(), $5, $6)
        ON CONFLICT (organization_id) DO UPDATE SET
            plan = $2,
            amount_cents = $3,
            billing_cycle = $4,
            status = 'active',
            current_period_start = NOW(),
            current_period_end = $5
    `, [orgId, plan, amount, billingCycle, periodEnd, reference]);

    // Update organization status
    await db.query(
        'UPDATE organizations SET plan = $1, subscription_status = $2, updated_at = NOW() WHERE id = $3',
        [plan, 'active', orgId]
    );

    // Log payment
    await db.query(
        'INSERT INTO payment_history (organization_id, amount_cents, status, gateway_reference) VALUES ($1, $2, $3, $4)',
        [orgId, amount, 'success', reference]
    );

    console.log(`✓ Subscription activated for org ${orgId}: ${plan} ${billingCycle}`);
}

async function handleSubscriptionCreate(data) {
    console.log('Subscription created:', data.subscription_code);
}

async function handleSubscriptionDisable(data) {
    const { metadata } = data;
    if (!metadata || !metadata.organization_id) return;

    await db.query(
        'UPDATE organizations SET subscription_status = $1, updated_at = NOW() WHERE id = $2',
        ['cancelled', metadata.organization_id]
    );

    await db.query(
        'UPDATE subscriptions SET status = $1, cancelled_at = NOW() WHERE organization_id = $2',
        ['cancelled', metadata.organization_id]
    );

    console.log(`✗ Subscription cancelled for org ${metadata.organization_id}`);
}

async function handleChargeFailed(data) {
    const { metadata } = data;
    if (!metadata || !metadata.organization_id) return;

    // Enter grace period
    await db.query(
        'UPDATE organizations SET subscription_status = $1, updated_at = NOW() WHERE id = $2',
        ['grace_period', metadata.organization_id]
    );

    console.log(`! Payment failed for org ${metadata.organization_id}, entering grace period`);
}

/**
 * POST /billing/cancel
 * Cancel subscription
 */
router.post('/cancel', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const org = req.organization;

        // Mark as cancelled (will remain active until period end)
        await db.query(
            'UPDATE subscriptions SET status = $1, cancelled_at = NOW() WHERE organization_id = $2',
            ['cancelled', org.id]
        );

        await db.query(
            'UPDATE organizations SET subscription_status = $1, updated_at = NOW() WHERE id = $2',
            ['cancelled', org.id]
        );

        res.json({ message: 'Subscription cancelled. You will have access until the end of your billing period.' });
    } catch (error) {
        console.error('Cancel subscription error:', error.message);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

// ============================================
// SEAT ADDON MANAGEMENT
// ============================================

const SEAT_ADDON_PRICE_CENTS = 20000; // R200 per seat

/**
 * GET /billing/seat-addons
 * Get current seat addon status
 */
router.get('/seat-addons', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const org = req.organization;

        // Only Professional plan can buy addons
        if (org.plan !== 'professional') {
            return res.json({
                available: false,
                message: org.plan === 'enterprise'
                    ? 'Enterprise plans have unlimited users'
                    : 'Upgrade to Professional to purchase extra seats'
            });
        }

        const result = await db.query(
            'SELECT * FROM seat_addons WHERE organization_id = $1 AND status = $2',
            [org.id, 'active']
        );

        const addon = result.rows[0] || null;

        res.json({
            available: true,
            pricePerSeat: SEAT_ADDON_PRICE_CENTS / 100,
            addon: addon ? {
                quantity: addon.quantity,
                totalMonthlyCost: (addon.quantity * addon.price_per_seat_cents) / 100,
                createdAt: addon.created_at
            } : null
        });
    } catch (error) {
        console.error('Get seat addons error:', error.message);
        res.status(500).json({ error: 'Failed to fetch seat addons' });
    }
});

/**
 * POST /billing/seat-addons/purchase
 * Purchase additional seats (or increase quantity)
 */
router.post('/seat-addons/purchase', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const org = req.organization;
        const { quantity } = req.body;

        // Validate
        if (!quantity || quantity < 1 || quantity > 100) {
            return res.status(400).json({ error: 'Quantity must be between 1 and 100' });
        }

        // Only Professional plan
        if (org.plan !== 'professional') {
            return res.status(403).json({
                error: 'Seat addons only available for Professional plan',
                code: 'PLAN_NOT_ELIGIBLE'
            });
        }

        // Check existing addon
        const existing = await db.query(
            'SELECT * FROM seat_addons WHERE organization_id = $1',
            [org.id]
        );

        let addon;
        if (existing.rows.length > 0) {
            // Update existing
            const result = await db.query(
                `UPDATE seat_addons 
                 SET quantity = quantity + $1, status = 'active', updated_at = NOW(), cancelled_at = NULL
                 WHERE organization_id = $2
                 RETURNING *`,
                [quantity, org.id]
            );
            addon = result.rows[0];
        } else {
            // Create new
            const result = await db.query(
                `INSERT INTO seat_addons (organization_id, quantity, price_per_seat_cents, status)
                 VALUES ($1, $2, $3, 'active')
                 RETURNING *`,
                [org.id, quantity, SEAT_ADDON_PRICE_CENTS]
            );
            addon = result.rows[0];
        }

        // In production: Initialize Paystack payment for addon
        // For now, we'll just activate it directly (would integrate with Paystack recurring)
        const reference = `seat_addon_${org.id}_${Date.now()}`;

        res.json({
            message: `Successfully added ${quantity} seat(s)`,
            addon: {
                quantity: addon.quantity,
                totalMonthlyCost: (addon.quantity * addon.price_per_seat_cents) / 100
            },
            paystack: {
                publicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_test_xxxxx',
                email: req.user.email,
                amount: quantity * SEAT_ADDON_PRICE_CENTS,
                currency: 'ZAR',
                reference: reference,
                metadata: {
                    organization_id: org.id,
                    type: 'seat_addon',
                    quantity: quantity
                }
            }
        });
    } catch (error) {
        console.error('Purchase seat addon error:', error.message);
        res.status(500).json({ error: 'Failed to purchase seat addon' });
    }
});

/**
 * DELETE /billing/seat-addons
 * Remove/reduce seat addons
 */
router.delete('/seat-addons', authenticateToken, loadOrganization, requireOrgOwner, async (req, res) => {
    try {
        const org = req.organization;
        const { quantity } = req.body;

        const existing = await db.query(
            'SELECT * FROM seat_addons WHERE organization_id = $1 AND status = $2',
            [org.id, 'active']
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'No active seat addons found' });
        }

        const addon = existing.rows[0];
        const removeQuantity = quantity || addon.quantity; // Remove all if not specified

        if (removeQuantity >= addon.quantity) {
            // Cancel all addons
            await db.query(
                `UPDATE seat_addons SET status = 'cancelled', cancelled_at = NOW() WHERE organization_id = $1`,
                [org.id]
            );
            res.json({ message: 'All seat addons cancelled', remainingSeats: 0 });
        } else {
            // Reduce quantity
            const result = await db.query(
                `UPDATE seat_addons SET quantity = quantity - $1, updated_at = NOW() WHERE organization_id = $2 RETURNING *`,
                [removeQuantity, org.id]
            );
            res.json({
                message: `Removed ${removeQuantity} seat(s)`,
                remainingSeats: result.rows[0].quantity
            });
        }
    } catch (error) {
        console.error('Remove seat addon error:', error.message);
        res.status(500).json({ error: 'Failed to remove seat addon' });
    }
});

module.exports = router;
