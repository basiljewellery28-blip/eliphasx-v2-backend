const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/search?q=query
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json({ clients: [], quotes: [] });
        }

        const searchTerm = `%${q}%`;

        // Search Clients (Name or Profile Number)
        // Sales can only see their own clients? Or all? 
        // Requirement: "search a client by their name or their client id"
        // Let's assume Sales can search all clients they have access to.
        // Admin sees all.

        let clientQuery = `
            SELECT id, name, company, profile_number, email 
            FROM clients 
            WHERE (name ILIKE $1 OR profile_number ILIKE $1)
        `;

        // RBAC for Clients (Mirroring clients.js logic)
        // If Sales, only their clients? Or all? 
        // Previous logic: GET /clients returns all for Admin, or created_by for Sales.
        // Let's stick to that for consistency.
        const clientValues = [searchTerm];
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            clientQuery += ` AND created_by = $2`;
            clientValues.push(req.user.id);
        }
        clientQuery += ` LIMIT 5`;

        const clientResult = await db.query(clientQuery, clientValues);

        // Search Quotes (Quote Number)
        // Requirement: "search... quote id"
        let quoteQuery = `
            SELECT q.id, q.quote_number, c.name as client_name, q.total, q.status 
            FROM quotes q
            LEFT JOIN clients c ON q.client_id = c.id
            WHERE q.quote_number ILIKE $1
        `;

        // RBAC for Quotes
        const quoteValues = [searchTerm];
        if (req.user.role !== 'admin' && req.user.role !== 'manager') {
            quoteQuery += ` AND q.user_id = $2`;
            quoteValues.push(req.user.id);
        }
        quoteQuery += ` LIMIT 5`;

        const quoteResult = await db.query(quoteQuery, quoteValues);

        res.json({
            clients: clientResult.rows,
            quotes: quoteResult.rows
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Search failed' });
    }
});

module.exports = router;
