const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, clientValidation } = require('../middleware/validation');

// GET all clients
router.get('/', authenticateToken, async (req, res) => {
    try {
        const query = `
      SELECT * FROM clients 
      WHERE created_by = $1 OR $2 = 'admin'
      ORDER BY name
    `;
        const result = await db.query(query, [req.user.id, req.user.role]);
        res.json({ clients: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch clients' });
    }
});

// POST create client
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
      INSERT INTO clients (profile_number, name, company, email, phone, pricing_template, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

        const values = [
            profileNumber, name, company, email, phone,
            JSON.stringify(pricing_template || {}), req.user.id
        ];

        const result = await db.query(query, values);
        res.status(201).json({ client: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create client' });
    }
});

module.exports = router;
