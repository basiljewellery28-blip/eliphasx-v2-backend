const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, quoteValidation } = require('../middleware/validation');
const { loadOrganization, requireActiveSubscription, checkQuoteLimit } = require('../middleware/tenant');
const PricingService = require('../services/pricingService');
const { logAudit, AuditAction } = require('../services/auditService');

// Apply tenant middleware to all routes
router.use(authenticateToken, loadOrganization);

// GET all quotes for organization
router.get('/', async (req, res) => {
    try {
        const orgId = req.organization.id;

        let query = `
          SELECT q.*, c.name as client_name, c.profile_number, u.email as user_email
          FROM quotes q 
          LEFT JOIN clients c ON q.client_id = c.id 
          LEFT JOIN users u ON q.user_id = u.id
          WHERE q.organization_id = $1
          ORDER BY q.created_at DESC
        `;

        // Non-admin only sees their own quotes
        if (req.user.role !== 'admin') {
            query = `
              SELECT q.*, c.name as client_name, c.profile_number 
              FROM quotes q 
              LEFT JOIN clients c ON q.client_id = c.id 
              WHERE q.organization_id = $1 AND q.user_id = $2
              ORDER BY q.created_at DESC
            `;
            const result = await db.query(query, [orgId, req.user.id]);
            return res.json({ quotes: result.rows });
        }

        const result = await db.query(query, [orgId]);
        res.json({ quotes: result.rows });
    } catch (error) {
        console.error('Fetch quotes error:', error.message);
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
router.post('/', authenticateToken, checkQuoteLimit, validate(quoteValidation.create), async (req, res) => {
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
        quote_number, client_id, user_id, organization_id, piece_category, brief_id,
        metal_type, metal_weight, metal_spot_price, metal_wastage, metal_markup,
        cad_hours, cad_base_rate, cad_revisions, cad_rendering_cost, cad_technical_cost, cad_markup,
        include_rendering_cost, include_technical_cost,
        manufacturing_technique, manufacturing_hours, manufacturing_base_rate, manufacturing_markup,
        stone_categories, stone_markup,
        finishing_cost, plating_cost, include_plating_cost, finishing_markup,
        findings, findings_markup,
        design_variations, cad_markup_image, subtotal, total, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
      RETURNING *
    `;

        const values = [
            quoteNumber,
            req.body.client_id,
            req.user.id,
            req.organization.id,  // organization_id
            req.body.piece_category,
            req.body.brief_id,
            req.body.metal_type,
            req.body.metal_weight,
            usedSpotPrice,
            req.body.metal_wastage,
            req.body.metal_markup,
            req.body.cad_hours || 0,
            req.body.cad_base_rate || 0,
            req.body.cad_revisions || 0,
            req.body.cad_rendering_cost || 0,
            req.body.cad_technical_cost || 0,
            req.body.cad_markup || 0,
            req.body.include_rendering_cost !== undefined ? req.body.include_rendering_cost : false,
            req.body.include_technical_cost !== undefined ? req.body.include_technical_cost : false,
            req.body.manufacturing_technique,
            req.body.manufacturing_hours || 0,
            req.body.manufacturing_base_rate || 0,
            req.body.manufacturing_markup || 0,
            JSON.stringify(req.body.stone_categories || []),
            req.body.stone_markup || 0,
            req.body.finishing_cost || 0,
            req.body.plating_cost || 0,
            req.body.include_plating_cost !== undefined ? req.body.include_plating_cost : false,
            req.body.finishing_markup || 0,
            JSON.stringify(req.body.findings || []),
            req.body.findings_markup || 0,
            JSON.stringify(req.body.design_variations || []),
            req.body.cad_markup_image || null,
            subtotalCost,
            totalPrice,
            req.body.status || 'draft'
        ];

        const result = await db.query(query, values);

        // Log quote creation
        logAudit({
            userId: req.user.id,
            organizationId: req.organization.id,
            action: AuditAction.CREATE_QUOTE,
            details: { quoteId: result.rows[0].id, quoteNumber: result.rows[0].quote_number, total: totalPrice },
            req
        });

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
            'piece_category', 'brief_id',
            'metal_type', 'metal_weight', 'metal_spot_price', 'metal_wastage', 'metal_markup',
            'cad_hours', 'cad_base_rate', 'cad_revisions', 'cad_markup',
            'include_rendering_cost', 'cad_rendering_cost',
            'include_technical_cost', 'cad_technical_cost',
            'manufacturing_technique', 'manufacturing_hours', 'manufacturing_base_rate', 'manufacturing_markup',
            'stone_categories', 'stone_markup',
            'finishing_cost', 'include_plating_cost', 'plating_cost', 'finishing_markup',
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

        // Log quote update
        logAudit({
            userId: req.user.id,
            organizationId: req.organization?.id,
            action: AuditAction.UPDATE_QUOTE,
            details: { quoteId: result.rows[0].id, status: result.rows[0].status },
            req
        });

        res.json({ quote: result.rows[0], calculations: calculated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update quote' });
    }
});

// PDF Generation
router.get('/:id/pdf', authenticateToken, loadOrganization, async (req, res) => {
    try {
        const { type } = req.query; // 'client' or 'admin'

        // Fetch quote and client
        const quoteResult = await db.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
        if (quoteResult.rows.length === 0) return res.status(404).json({ error: 'Quote not found' });
        const quote = quoteResult.rows[0];

        const clientResult = await db.query('SELECT * FROM clients WHERE id = $1', [quote.client_id]);
        const client = clientResult.rows[0] || {};

        // Get organization branding
        const branding = req.organization?.settings?.branding || {};

        const PDFService = require('../services/pdfService');
        const pdfBuffer = await PDFService.generateQuotePDF(quote, client, type, branding);

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

// ============================================
// QUOTE APPROVAL WORKFLOW ENDPOINTS
// ============================================

/**
 * GET /quotes/pending-approval
 * Get all quotes pending approval for managers/admins
 */
router.get('/pending-approval', async (req, res) => {
    try {
        // Only admins and org owners can view pending approvals
        if (req.user.role !== 'admin' && !req.user.is_org_owner) {
            return res.status(403).json({ error: 'Only managers can view pending approvals' });
        }

        const result = await db.query(`
            SELECT q.*, c.name as client_name, c.company, u.email as submitted_by_email,
                   u.first_name as submitted_by_first_name, u.last_name as submitted_by_last_name
            FROM quotes q
            LEFT JOIN clients c ON q.client_id = c.id
            LEFT JOIN users u ON q.submitted_for_approval_by = u.id
            WHERE q.organization_id = $1 
              AND q.status = 'pending_approval'
            ORDER BY q.submitted_for_approval_at DESC
        `, [req.organization.id]);

        res.json({ quotes: result.rows });
    } catch (error) {
        console.error('Fetch pending approvals error:', error.message);
        res.status(500).json({ error: 'Failed to fetch pending approvals' });
    }
});

/**
 * POST /quotes/:id/submit-for-approval
 * Submit a quote for manager approval
 */
router.post('/:id/submit-for-approval', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        // Verify quote belongs to this organization and user
        const quoteCheck = await db.query(
            'SELECT * FROM quotes WHERE id = $1 AND organization_id = $2',
            [id, req.organization.id]
        );

        if (quoteCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const quote = quoteCheck.rows[0];

        // Can't submit if already pending or approved
        if (quote.status === 'pending_approval') {
            return res.status(400).json({ error: 'Quote is already pending approval' });
        }
        if (quote.status === 'approved') {
            return res.status(400).json({ error: 'Quote is already approved' });
        }

        // Update quote status
        const result = await db.query(`
            UPDATE quotes 
            SET status = 'pending_approval',
                submitted_for_approval_by = $1,
                submitted_for_approval_at = NOW(),
                approval_notes = $2
            WHERE id = $3
            RETURNING *
        `, [req.user.id, notes || null, id]);

        // Log the action
        logAudit({
            userId: req.user.id,
            organizationId: req.organization.id,
            action: 'QUOTE_SUBMITTED_FOR_APPROVAL',
            details: { quoteId: id, quoteNumber: quote.quote_number },
            req
        });

        res.json({
            message: 'Quote submitted for approval',
            quote: result.rows[0]
        });
    } catch (error) {
        console.error('Submit for approval error:', error.message);
        res.status(500).json({ error: 'Failed to submit quote for approval' });
    }
});

/**
 * PUT /quotes/:id/approve
 * Approve a quote (managers/admins only)
 */
router.put('/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        // Only admins and org owners can approve
        if (req.user.role !== 'admin' && !req.user.is_org_owner) {
            return res.status(403).json({ error: 'Only managers can approve quotes' });
        }

        // Verify quote exists and is pending
        const quoteCheck = await db.query(
            'SELECT * FROM quotes WHERE id = $1 AND organization_id = $2',
            [id, req.organization.id]
        );

        if (quoteCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const quote = quoteCheck.rows[0];

        if (quote.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Quote is not pending approval' });
        }

        // Approve the quote
        const result = await db.query(`
            UPDATE quotes 
            SET status = 'approved',
                approved_by = $1,
                approved_at = NOW(),
                approval_notes = COALESCE($2, approval_notes)
            WHERE id = $3
            RETURNING *
        `, [req.user.id, notes || null, id]);

        // Log the action
        logAudit({
            userId: req.user.id,
            organizationId: req.organization.id,
            action: 'QUOTE_APPROVED',
            details: {
                quoteId: id,
                quoteNumber: quote.quote_number,
                approvedBy: req.user.email
            },
            req
        });

        res.json({
            message: 'Quote approved successfully',
            quote: result.rows[0]
        });
    } catch (error) {
        console.error('Approve quote error:', error.message);
        res.status(500).json({ error: 'Failed to approve quote' });
    }
});

/**
 * PUT /quotes/:id/reject
 * Reject a quote with reason (managers/admins only)
 */
router.put('/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === '') {
            return res.status(400).json({ error: 'Rejection reason is required' });
        }

        // Only admins and org owners can reject
        if (req.user.role !== 'admin' && !req.user.is_org_owner) {
            return res.status(403).json({ error: 'Only managers can reject quotes' });
        }

        // Verify quote exists and is pending
        const quoteCheck = await db.query(
            'SELECT * FROM quotes WHERE id = $1 AND organization_id = $2',
            [id, req.organization.id]
        );

        if (quoteCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Quote not found' });
        }

        const quote = quoteCheck.rows[0];

        if (quote.status !== 'pending_approval') {
            return res.status(400).json({ error: 'Quote is not pending approval' });
        }

        // Reject the quote (set back to draft with rejection notes)
        const result = await db.query(`
            UPDATE quotes 
            SET status = 'rejected',
                approval_notes = $1,
                approved_by = $2,
                approved_at = NOW()
            WHERE id = $3
            RETURNING *
        `, [reason, req.user.id, id]);

        // Log the action
        logAudit({
            userId: req.user.id,
            organizationId: req.organization.id,
            action: 'QUOTE_REJECTED',
            details: {
                quoteId: id,
                quoteNumber: quote.quote_number,
                rejectedBy: req.user.email,
                reason: reason
            },
            req
        });

        res.json({
            message: 'Quote rejected',
            quote: result.rows[0]
        });
    } catch (error) {
        console.error('Reject quote error:', error.message);
        res.status(500).json({ error: 'Failed to reject quote' });
    }
});

module.exports = router;
