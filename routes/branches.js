/**
 * Branch Management Routes
 * For Enterprise multi-branch support
 */

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { loadOrganization, requireActiveSubscription } = require('../middleware/tenant');
const xss = require('xss');

// Apply middleware to all routes
router.use(authenticateToken, loadOrganization);

// Middleware to check Enterprise plan
const requireEnterprise = (req, res, next) => {
    if (req.organization.plan !== 'enterprise') {
        return res.status(403).json({
            error: 'Multi-branch is only available on Enterprise plans',
            code: 'ENTERPRISE_REQUIRED'
        });
    }
    next();
};

// Middleware to check org owner
const requireOrgOwner = (req, res, next) => {
    if (!req.user.is_org_owner) {
        return res.status(403).json({ error: 'Only organization owners can manage branches' });
    }
    next();
};

// ============================================
// ORGANIZATION GROUP MANAGEMENT
// ============================================

/**
 * POST /branches/group
 * Create or get organization group
 */
router.post('/group', requireEnterprise, requireOrgOwner, async (req, res) => {
    try {
        const org = req.organization;
        const { name } = req.body;

        // Check if group already exists for this org
        const existing = await db.query(
            'SELECT * FROM organization_groups WHERE owner_organization_id = $1',
            [org.id]
        );

        if (existing.rows.length > 0) {
            return res.json({
                message: 'Group already exists',
                group: existing.rows[0]
            });
        }

        // Create new group
        const result = await db.query(
            `INSERT INTO organization_groups (name, owner_organization_id, settings)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [xss(name || `${org.name} Group`), org.id, JSON.stringify({})]
        );

        const group = result.rows[0];

        // Link the parent org to the group
        await db.query(
            'UPDATE organizations SET group_id = $1, is_branch = false WHERE id = $2',
            [group.id, org.id]
        );

        res.status(201).json({
            message: 'Organization group created',
            group
        });
    } catch (error) {
        console.error('Create group error:', error.message);
        res.status(500).json({ error: 'Failed to create organization group' });
    }
});

/**
 * GET /branches/group
 * Get organization group with all branches
 */
router.get('/group', requireEnterprise, async (req, res) => {
    try {
        const org = req.organization;

        // Get group
        const groupResult = await db.query(
            `SELECT g.* FROM organization_groups g
             WHERE g.owner_organization_id = $1
             OR EXISTS (SELECT 1 FROM organizations o WHERE o.id = $1 AND o.group_id = g.id)`,
            [org.id]
        );

        if (groupResult.rows.length === 0) {
            return res.json({ group: null, branches: [] });
        }

        const group = groupResult.rows[0];

        // Get all branches in this group
        const branchesResult = await db.query(
            `SELECT o.id, o.name, o.slug, o.is_branch, o.created_at,
                    (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) as user_count,
                    (SELECT COUNT(*) FROM quotes q WHERE q.organization_id = o.id) as quote_count
             FROM organizations o
             WHERE o.group_id = $1
             ORDER BY o.is_branch ASC, o.name ASC`,
            [group.id]
        );

        res.json({
            group,
            branches: branchesResult.rows
        });
    } catch (error) {
        console.error('Get group error:', error.message);
        res.status(500).json({ error: 'Failed to fetch organization group' });
    }
});

// ============================================
// BRANCH MANAGEMENT
// ============================================

/**
 * POST /branches
 * Create a new branch organization
 */
router.post('/', requireEnterprise, requireOrgOwner, async (req, res) => {
    try {
        const org = req.organization;
        const { name, contactEmail, phone } = req.body;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({ error: 'Branch name is required' });
        }

        // Get or create group
        let group = (await db.query(
            'SELECT * FROM organization_groups WHERE owner_organization_id = $1',
            [org.id]
        )).rows[0];

        if (!group) {
            // Auto-create group
            const groupResult = await db.query(
                `INSERT INTO organization_groups (name, owner_organization_id)
                 VALUES ($1, $2) RETURNING *`,
                [`${org.name} Group`, org.id]
            );
            group = groupResult.rows[0];

            // Link parent to group
            await db.query(
                'UPDATE organizations SET group_id = $1 WHERE id = $2',
                [group.id, org.id]
            );
        }

        // Generate unique slug
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) + '-' + Date.now().toString(36);

        // Create branch organization
        const branchResult = await db.query(
            `INSERT INTO organizations (
                name, slug, plan, subscription_status, group_id, is_branch,
                contact_email, phone, settings
             ) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)
             RETURNING *`,
            [
                xss(name),
                slug,
                org.plan, // Inherit plan from parent
                org.subscription_status,
                group.id,
                xss(contactEmail || org.contact_email || ''),
                xss(phone || ''),
                JSON.stringify({})
            ]
        );

        const branch = branchResult.rows[0];

        // Grant the owner access to the new branch
        await db.query(
            `INSERT INTO user_branch_access (user_id, organization_id, role, granted_by)
             VALUES ($1, $2, 'admin', $3)
             ON CONFLICT (user_id, organization_id) DO NOTHING`,
            [req.user.id, branch.id, req.user.id]
        );

        res.status(201).json({
            message: 'Branch created successfully',
            branch
        });
    } catch (error) {
        console.error('Create branch error:', error.message);
        res.status(500).json({ error: 'Failed to create branch' });
    }
});

/**
 * GET /branches
 * List all branches the user has access to
 */
router.get('/', async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.organization.id;

        // Get branches from user's primary org group + explicit access
        const result = await db.query(
            `SELECT DISTINCT o.id, o.name, o.slug, o.is_branch, o.group_id,
                    CASE WHEN o.id = $2 THEN true ELSE false END as is_current,
                    COALESCE(uba.role, CASE WHEN o.id = $2 THEN $3 ELSE 'sales' END) as user_role
             FROM organizations o
             LEFT JOIN user_branch_access uba ON uba.organization_id = o.id AND uba.user_id = $1
             WHERE o.id = $2
                OR o.group_id = (SELECT group_id FROM organizations WHERE id = $2)
                OR uba.user_id = $1
             ORDER BY o.is_branch ASC, o.name ASC`,
            [userId, orgId, req.user.role]
        );

        res.json({ branches: result.rows });
    } catch (error) {
        console.error('List branches error:', error.message);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
});

/**
 * PUT /branches/:id
 * Update branch details
 */
router.put('/:id', requireEnterprise, requireOrgOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, contactEmail, phone } = req.body;

        // Verify branch belongs to same group
        const branch = await db.query(
            `SELECT b.* FROM organizations b
             JOIN organizations p ON b.group_id = p.group_id
             WHERE b.id = $1 AND p.id = $2 AND b.is_branch = true`,
            [id, req.organization.id]
        );

        if (branch.rows.length === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        const result = await db.query(
            `UPDATE organizations 
             SET name = COALESCE($1, name),
                 contact_email = COALESCE($2, contact_email),
                 phone = COALESCE($3, phone),
                 updated_at = NOW()
             WHERE id = $4
             RETURNING *`,
            [xss(name), xss(contactEmail), xss(phone), id]
        );

        res.json({ branch: result.rows[0] });
    } catch (error) {
        console.error('Update branch error:', error.message);
        res.status(500).json({ error: 'Failed to update branch' });
    }
});

/**
 * DELETE /branches/:id
 * Delete a branch (moves users back to parent)
 */
router.delete('/:id', requireEnterprise, requireOrgOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const parentOrgId = req.organization.id;

        // Verify branch belongs to same group and is not the parent
        const branch = await db.query(
            `SELECT b.* FROM organizations b
             JOIN organizations p ON b.group_id = p.group_id
             WHERE b.id = $1 AND p.id = $2 AND b.is_branch = true`,
            [id, parentOrgId]
        );

        if (branch.rows.length === 0) {
            return res.status(404).json({ error: 'Branch not found or cannot delete parent organization' });
        }

        // Move users back to parent org
        await db.query(
            'UPDATE users SET organization_id = $1 WHERE organization_id = $2',
            [parentOrgId, id]
        );

        // Remove branch access records
        await db.query('DELETE FROM user_branch_access WHERE organization_id = $1', [id]);

        // Delete the branch (cascades to quotes, clients, etc.)
        await db.query('DELETE FROM organizations WHERE id = $1', [id]);

        res.json({ message: 'Branch deleted successfully' });
    } catch (error) {
        console.error('Delete branch error:', error.message);
        res.status(500).json({ error: 'Failed to delete branch' });
    }
});

// ============================================
// USER BRANCH ACCESS MANAGEMENT
// ============================================

/**
 * POST /branches/:id/users
 * Grant user access to a branch
 */
router.post('/:id/users', requireEnterprise, requireOrgOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, role } = req.body;

        // Verify branch belongs to same group
        const branch = await db.query(
            `SELECT b.* FROM organizations b
             JOIN organizations p ON b.group_id = p.group_id OR p.id = b.id
             WHERE b.id = $1 AND p.id = $2`,
            [id, req.organization.id]
        );

        if (branch.rows.length === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }

        // Grant access
        const result = await db.query(
            `INSERT INTO user_branch_access (user_id, organization_id, role, granted_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, organization_id) 
             DO UPDATE SET role = $3
             RETURNING *`,
            [userId, id, role || 'sales', req.user.id]
        );

        res.json({
            message: 'User access granted',
            access: result.rows[0]
        });
    } catch (error) {
        console.error('Grant branch access error:', error.message);
        res.status(500).json({ error: 'Failed to grant branch access' });
    }
});

/**
 * GET /branches/:id/users
 * Get users with access to a branch
 */
router.get('/:id/users', requireEnterprise, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.role as primary_role,
                    COALESCE(uba.role, u.role) as branch_role,
                    CASE WHEN u.organization_id = $1 THEN true ELSE false END as is_primary_user
             FROM users u
             LEFT JOIN user_branch_access uba ON uba.user_id = u.id AND uba.organization_id = $1
             WHERE u.organization_id = $1 OR uba.organization_id = $1
             ORDER BY u.first_name, u.last_name`,
            [id]
        );

        res.json({ users: result.rows });
    } catch (error) {
        console.error('Get branch users error:', error.message);
        res.status(500).json({ error: 'Failed to fetch branch users' });
    }
});

/**
 * DELETE /branches/:id/users/:userId
 * Remove user access from a branch
 */
router.delete('/:id/users/:userId', requireEnterprise, requireOrgOwner, async (req, res) => {
    try {
        const { id, userId } = req.params;

        await db.query(
            'DELETE FROM user_branch_access WHERE user_id = $1 AND organization_id = $2',
            [userId, id]
        );

        res.json({ message: 'User access removed' });
    } catch (error) {
        console.error('Remove branch access error:', error.message);
        res.status(500).json({ error: 'Failed to remove branch access' });
    }
});

module.exports = router;
