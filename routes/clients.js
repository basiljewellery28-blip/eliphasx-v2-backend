const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireOrgOwner } = require('../middleware/auth');
const { validate, clientValidation } = require('../middleware/validation');
const { loadOrganization } = require('../middleware/tenant');
const EmailService = require('../services/emailService');
const xss = require('xss');

// Apply tenant middleware to all routes
router.use(authenticateToken, loadOrganization);

// GET unverified count (Org Owner or Admin, scoped to organization)
router.get('/unverified-count', requireOrgOwner, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT COUNT(*) FROM clients WHERE is_verified = false AND organization_id = $1',
            [req.organization.id]
        );
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch count' });
    }
});

// GET all clients (scoped to organization)
router.get('/', async (req, res) => {
    try {
        const orgId = req.organization.id;

        // Admin sees all org clients, sales sees only their own
        let query;
        let params;

        if (req.user.role === 'admin') {
            query = `
                SELECT * FROM clients 
                WHERE organization_id = $1
                ORDER BY is_verified ASC, created_at DESC
            `;
            params = [orgId];
        } else {
            query = `
                SELECT * FROM clients 
                WHERE organization_id = $1 AND created_by = $2
                ORDER BY is_verified ASC, created_at DESC
            `;
            params = [orgId, req.user.id];
        }

        const result = await db.query(query, params);
        res.json({ clients: result.rows });
    } catch (error) {
        console.error('Fetch clients error:', error.message);
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// GET client stats (scoped to organization)
router.get('/:id/stats', async (req, res) => {
    try {
        const clientId = parseInt(req.params.id);
        if (isNaN(clientId)) {
            return res.status(400).json({ error: 'Invalid client ID' });
        }

        // Verify client belongs to this organization
        const clientCheck = await db.query(
            'SELECT id, created_by, organization_id FROM clients WHERE id = $1 AND organization_id = $2',
            [clientId, req.organization.id]
        );

        if (clientCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Check access (Admin or Owner)
        if (req.user.role !== 'admin' && clientCheck.rows[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const query = `
            SELECT status, COUNT(*) as count 
            FROM quotes 
            WHERE client_id = $1 AND organization_id = $2
            GROUP BY status
        `;

        const result = await db.query(query, [clientId, req.organization.id]);

        const stats = {
            completed: 0,
            draft: 0,
            pending_approval: 0,
            approved: 0
        };

        result.rows.forEach(row => {
            if (stats[row.status] !== undefined) {
                stats[row.status] = parseInt(row.count);
            }
        });

        res.json({ stats });
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({ error: 'Failed to fetch client stats' });
    }
});

// POST create client (scoped to organization)
router.post('/', validate(clientValidation.create), async (req, res) => {
    try {
        // Sanitize all user inputs
        const name = xss(req.body.name);
        const company = xss(req.body.company);
        const email = xss(req.body.email || '');
        const phone = xss(req.body.phone || '');
        const pricing_template = req.body.pricing_template;
        const orgId = req.organization.id;

        // Generate profile number (unique per organization)
        const latestClient = await db.query(
            'SELECT profile_number FROM clients WHERE organization_id = $1 ORDER BY id DESC LIMIT 1',
            [orgId]
        );

        let nextNumber = 1;
        if (latestClient.rows.length > 0 && latestClient.rows[0].profile_number) {
            const parts = latestClient.rows[0].profile_number.split('-');
            if (parts.length >= 3) {
                const lastNumber = parseInt(parts[2]);
                if (!isNaN(lastNumber)) {
                    nextNumber = lastNumber + 1;
                }
            }
        }

        // Use org slug or ID in profile number for uniqueness
        const orgPrefix = req.organization.slug?.substring(0, 3).toUpperCase() || 'ORG';
        const profileNumber = `${orgPrefix}-${new Date().getFullYear().toString().slice(-2)}-${nextNumber.toString().padStart(3, '0')}`;

        const query = `
            INSERT INTO clients (profile_number, name, company, email, phone, pricing_template, created_by, organization_id, is_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
            RETURNING *
        `;

        const values = [
            profileNumber, name, company, email, phone,
            JSON.stringify(pricing_template || {}), req.user.id, orgId
        ];

        const result = await db.query(query, values);
        const newClient = result.rows[0];

        // Notify Admin
        await EmailService.sendNewClientNotification(newClient, req.user.email);

        res.status(201).json({ client: newClient });
    } catch (error) {
        console.error('Client creation error:', error.message);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// PUT verify client (Org Owner or Admin, scoped to organization)
router.put('/:id/verify', requireOrgOwner, async (req, res) => {
    try {
        const result = await db.query(
            'UPDATE clients SET is_verified = true WHERE id = $1 AND organization_id = $2 RETURNING *',
            [req.params.id, req.organization.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

        res.json({ client: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to verify client' });
    }
});

// PUT update client (Org Owner or Admin, scoped to organization)
router.put('/:id', requireOrgOwner, async (req, res) => {
    try {
        console.log('Update Client Request:', req.params.id, req.body);
        const { name, company, email, phone, pricing_template } = req.body;
        const clientId = req.params.id;

        const query = `
            UPDATE clients 
            SET name = COALESCE($1, name),
                company = COALESCE($2, company),
                email = COALESCE($3, email),
                phone = COALESCE($4, phone),
                pricing_template = COALESCE($5::jsonb, pricing_template)
            WHERE id = $6 AND organization_id = $7
            RETURNING *
        `;

        const values = [
            name, company, email, phone,
            pricing_template ? JSON.stringify(pricing_template) : null,
            clientId, req.organization.id
        ];

        const result = await db.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ client: result.rows[0] });
    } catch (error) {
        console.error('Update Client Error:', error);
        res.status(500).json({ error: 'Failed to update client', details: error.message });
    }
});

module.exports = router;
