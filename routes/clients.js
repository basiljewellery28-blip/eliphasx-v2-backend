const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validate, clientValidation } = require('../middleware/validation');
const EmailService = require('../services/emailService');

// GET unverified count (Admin/Manager only)
router.get('/unverified-count', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT COUNT(*) FROM clients WHERE is_verified = false');
        res.json({ count: parseInt(result.rows[0].count) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch count' });
    }
});

// GET all clients
router.get('/', authenticateToken, async (req, res) => {
    try {
        const query = `
      SELECT * FROM clients 
      WHERE created_by = $1 OR $2 = 'admin' OR $2 = 'manager'
      ORDER BY is_verified ASC, created_at DESC
    `;
        const result = await db.query(query, [req.user.id, req.user.role]);
        res.json({ clients: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// GET client stats
router.get('/:id/stats', authenticateToken, async (req, res) => {
    try {
        const clientId = req.params.id;

        // Check access (Admin/Manager or Owner)
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            const clientCheck = await db.query('SELECT created_by FROM clients WHERE id = $1', [clientId]);
            if (clientCheck.rows.length === 0 || clientCheck.rows[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const query = `
            SELECT status, COUNT(*) as count 
            FROM quotes 
            WHERE client_id = $1 
            GROUP BY status
        `;

        const result = await db.query(query, [clientId]);

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
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch client stats' });
    }
});

// POST create client (Open to all authenticated users, notifies Admin)
router.post('/', authenticateToken, validate(clientValidation.create), async (req, res) => {
    try {
        const { name, company, email, phone, pricing_template } = req.body;

        // Generate profile number
        const latestClient = await db.query(
            'SELECT profile_number FROM clients WHERE profile_number LIKE $1 ORDER BY id DESC LIMIT 1',
            ['REC-Q28-%']
        );

        let nextNumber = 1;
        if (latestClient.rows.length > 0) {
            const lastNumber = parseInt(latestClient.rows[0].profile_number.split('-')[2]);
            nextNumber = lastNumber + 1;
        }

        const profileNumber = `REC-Q28-${nextNumber.toString().padStart(2, '0')}`;

        const query = `
      INSERT INTO clients (profile_number, name, company, email, phone, pricing_template, created_by, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, false)
      RETURNING *
    `;

        const values = [
            profileNumber, name, company, email, phone,
            JSON.stringify(pricing_template || {}), req.user.id
        ];

        const result = await db.query(query, values);
        const newClient = result.rows[0];

        // Notify Admin
        await EmailService.sendNewClientNotification(newClient, req.user.email);

        res.status(201).json({ client: newClient });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

// PUT verify client (Admin/Manager only)
router.put('/:id/verify', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            'UPDATE clients SET is_verified = true WHERE id = $1 RETURNING *',
            [req.params.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

        res.json({ client: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to verify client' });
    }
});

// PUT update client (Restricted to Admin/Manager)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
            WHERE id = $6
            RETURNING *
        `;

        const values = [
            name, company, email, phone,
            pricing_template ? JSON.stringify(pricing_template) : null,
            clientId
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
