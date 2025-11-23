const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET metal prices (Public to authenticated users)
router.get('/metal-prices', authenticateToken, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM metal_prices WHERE is_active = true ORDER BY metal_type');
        res.json({ metalPrices: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch metal prices' });
    }
});

// PUT update metal prices (Admin only)
router.put('/metal-prices', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { prices } = req.body; // Expecting array of { id, price } or { metal_type, price }

        // Use a transaction for bulk update
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            for (const item of prices) {
                await client.query(
                    'UPDATE metal_prices SET price = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE metal_type = $3',
                    [item.price, req.user.id, item.metal_type]
                );
            }

            await client.query('COMMIT');
            res.json({ message: 'Prices updated successfully' });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update prices' });
    }
});

// GET stone prices (Public to authenticated users)
router.get('/stone-prices', authenticateToken, async (req, res) => {
    try {
        // Check if table exists and has the correct columns, if not recreate it (simplest for dev)
        // In production, we would use proper migrations. Here we'll check for setting_style column.
        const checkColumn = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='stone_prices' AND column_name='setting_style'
        `);

        if (checkColumn.rows.length === 0) {
            // Drop and recreate to enforce new schema
            await db.query('DROP TABLE IF EXISTS stone_prices');
            await db.query(`
                CREATE TABLE stone_prices (
                    id SERIAL PRIMARY KEY,
                    stone_type VARCHAR(100) NOT NULL,
                    setting_style VARCHAR(100) NOT NULL,
                    size_category VARCHAR(100) NOT NULL,
                    cost DECIMAL(10,2) DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    updated_by INTEGER REFERENCES users(id),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(stone_type, setting_style, size_category)
                );
            `);

            // Seed defaults
            const stoneTypes = ['Diamond', 'Precious', 'Semi Precious', 'Organic'];
            const settingStyles = ['Claw', 'Bezel', 'Micro Pave', 'Flush', 'Channel'];
            const sizes = ['Smalls', 'Medium', 'Center'];

            // Base costs for seeding (just to have some variation)
            const baseRates = {
                'Claw': 50, 'Bezel': 80, 'Micro Pave': 60, 'Flush': 70, 'Channel': 90
            };
            const sizeMultipliers = { 'Smalls': 1, 'Medium': 2, 'Center': 5 };
            const typeMultipliers = { 'Diamond': 1.5, 'Precious': 1.2, 'Semi Precious': 1, 'Organic': 0.8 };

            for (const type of stoneTypes) {
                for (const style of settingStyles) {
                    for (const size of sizes) {
                        const cost = Math.round(baseRates[style] * sizeMultipliers[size] * typeMultipliers[type]);
                        await db.query(
                            'INSERT INTO stone_prices (stone_type, setting_style, size_category, cost) VALUES ($1, $2, $3, $4)',
                            [type, style, size, cost]
                        );
                    }
                }
            }
        }

        const result = await db.query('SELECT * FROM stone_prices WHERE is_active = true ORDER BY stone_type, setting_style, size_category');
        res.json({ stonePrices: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch stone prices' });
    }
});

// PUT update stone prices (Admin only)
router.put('/stone-prices', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { prices } = req.body; // Expecting array of { id, cost }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            for (const item of prices) {
                await client.query(
                    'UPDATE stone_prices SET cost = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
                    [item.cost, req.user.id, item.id]
                );
            }

            await client.query('COMMIT');
            res.json({ message: 'Stone prices updated successfully' });
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update stone prices' });
    }
});

module.exports = router;
