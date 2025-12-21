/**
 * Billing Routes
 * Handles subscription management with Paystack
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireOrgOwner } = require('../middleware/auth');
const { loadOrganization } = require('../middleware/tenant');
const crypto = require('crypto');

// Plan configurations (in kobo/cents - Paystack uses smallest currency unit)
// Plan configurations (in kobo/cents - Paystack uses smallest currency unit)
const PLANS = {
    starter: {
        monthly: { amount: 89900, name: 'Starter Monthly' },
        annual: { amount: 899000, name: 'Starter Annual' }
    },
    growth: {
        monthly: { amount: 199900, name: 'Growth Monthly' },
        annual: { amount: 1999000, name: 'Growth Annual' }
    },
    scale: {
        monthly: { amount: 399900, name: 'Scale Monthly' },
        annual: { amount: 3999000, name: 'Scale Annual' }
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

module.exports = router;
