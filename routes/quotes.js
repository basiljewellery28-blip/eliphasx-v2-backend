const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, quoteValidation } = require('../middleware/validation');
const PricingService = require('../services/pricingService'); // Import PricingService

// GET all quotes for user
router.get('/', authenticateToken, async (req, res) => {
    try {
        let query = `
      SELECT q.*, c.name as client_name, c.profile_number 
      FROM quotes q 
      LEFT JOIN clients c ON q.client_id = c.id 
      WHERE q.user_id = $1 
      ORDER BY q.created_at DESC
    `;

        // Admin can see all quotes
        if (req.user.role === 'admin') {
            query = `
        SELECT q.*, c.name as client_name, c.profile_number, u.email as user_email
        FROM quotes q 
        LEFT JOIN clients c ON q.client_id = c.id 
        LEFT JOIN users u ON q.user_id = u.id
        ORDER BY q.created_at DESC
      `;
        }

        const result = await db.query(query, req.user.role === 'admin' ? [] : [req.user.id]);
        res.json({ quotes: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch quotes' });
    }
});

// GET single quote
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const query = `
      SELECT q.*, c.name as client_name, c.profile_number, c.company, c.email, c.phone 
      FROM quotes q 
      LEFT JOIN clients c ON q.client_id = c.id 
      WHERE q.id = $1 AND (q.user_id = $2 OR $3 = 'admin')
    `;

        const result = await db.query(query, [req.params.id, req.user.id, req.user.role]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        res.json({ quote: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch quote' });
    }
});

// POST create quote
router.post('/', authenticateToken, validate(quoteValidation.create), async (req, res) => {
    console.log('Backend: Received POST /quotes request');
    console.log('Request body keys:', Object.keys(req.body));
    try {
        const { calculateQuote } = require('../services/calculationService');

        // 1. Fetch System Rates
        const systemRates = await PricingService.getSystemRates();

        // 2. Calculate totals using system rates
        const calculated = calculateQuote(req.body, systemRates);
        const { subtotalCost, totalPrice } = calculated.totals;
        const usedSpotPrice = calculated.sections.metal.spotPrice; // Validated price

        const {
            client_id, piece_category, brief_id, metal_type, metal_weight,
            metal_wastage, metal_markup, design_variations, cad_markup_image
        } = req.body;

        // Generate quote number
        const quoteNumber = `Q-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

        const query = `
      INSERT INTO quotes (
        quote_number, client_id, user_id, piece_category, brief_id,
        metal_type, metal_weight, metal_spot_price, metal_wastage, metal_markup,
        design_variations, cad_markup_image, subtotal, total, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;

        const values = [
            quoteNumber, client_id, req.user.id, piece_category, brief_id,
            metal_type, metal_weight, usedSpotPrice, metal_wastage, metal_markup,
            JSON.stringify(design_variations || []),
            cad_markup_image || null,
            subtotalCost, totalPrice,
            'draft' // status
        ];

        const result = await db.query(query, values);
        res.status(201).json({ quote: result.rows[0], calculations: calculated });
    } catch (error) {
        console.error('Quote Creation Error:', error);
        res.status(500).json({ error: 'Failed to create quote', details: error.message });
    }
});

// PUT update quote
router.put('/:id', authenticateToken, validate(quoteValidation.update), async (req, res) => {
    try {
        const { calculateQuote } = require('../services/calculationService');

        // 1. Fetch System Rates
        const systemRates = await PricingService.getSystemRates();

        // 2. Calculate totals using system rates
        const calculated = calculateQuote(req.body, systemRates);
        const { subtotalCost, totalPrice } = calculated.totals;
        const usedSpotPrice = calculated.sections.metal.spotPrice; // Validated price

        // 3. Prepare update data
        const updateData = {
            ...req.body,
            subtotal: subtotalCost,
            total: totalPrice,
            metal_spot_price: usedSpotPrice // Enforce validated price
        };

        const fields = [];
        const values = [];
        let idx = 1;

        const allowedFields = [
            'metal_type', 'metal_weight', 'metal_spot_price', 'metal_wastage', 'metal_markup',
            'cad_hours', 'cad_base_rate', 'cad_revisions', 'cad_markup',
            'manufacturing_technique', 'manufacturing_hours', 'manufacturing_base_rate', 'manufacturing_markup',
            'stone_categories', 'stone_markup',
            'finishing_cost', 'plating_cost', 'finishing_markup',
            'findings', 'findings_markup',
            'design_variations', 'cad_markup_image', 'subtotal', 'total', 'status' // status can be: draft, pending_approval, approved, completed
        ];

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                fields.push(`${field} = $${idx}`);
                values.push(
                    ['design_variations', 'stone_categories', 'findings'].includes(field)
                        ? JSON.stringify(updateData[field])
                        : updateData[field]
                );
                idx++;
            }
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(req.params.id);
        values.push(req.user.id);
        values.push(req.user.role);

        const query = `
      UPDATE quotes SET
        ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${idx} AND (user_id = $${idx + 1} OR $${idx + 2} = 'admin')
      RETURNING *
    `;

        const result = await db.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found or access denied' });
        }

        res.json({ quote: result.rows[0], calculations: calculated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update quote' });
    }
});

// PDF Generation
router.get('/:id/pdf', authenticateToken, async (req, res) => {
    try {
        const { type } = req.query; // 'client' or 'admin'

        // Fetch quote and client
        const quoteResult = await db.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
        if (quoteResult.rows.length === 0) return res.status(404).json({ error: 'Quote not found' });
        const quote = quoteResult.rows[0];

        const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [quote.client_id]);
        const client = clientResult.rows[0] || {};

        const PDFService = require('../services/pdfService');
        const pdfBuffer = await PDFService.generateQuotePDF(quote, client, type);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename=quote-${quote.quote_number}.pdf`,
            'Content-Length': pdfBuffer.length
        });

        res.send(pdfBuffer);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate PDF' });
    }
});

module.exports = router;
