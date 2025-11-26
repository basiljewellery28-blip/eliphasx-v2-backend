const db = require('../config/database');

class PricingService {
    static async getSystemRates() {
        try {
            // 1. Fetch Metal Prices
            const metalResult = await db.query('SELECT * FROM metal_prices WHERE is_active = true');
            const metalPrices = {};
            metalResult.rows.forEach(row => {
                metalPrices[row.metal_type] = parseFloat(row.price);
            });

            // 2. Fetch Stone Prices (Setting Costs)
            // Note: We need to handle the case where the table might not exist or be empty during dev
            let stonePrices = [];
            try {
                const stoneResult = await db.query('SELECT * FROM stone_prices WHERE is_active = true');
                stonePrices = stoneResult.rows;
            } catch (error) {
                console.warn('Stone prices table might not exist yet:', error.message);
            }

            return {
                metalPrices,
                stonePrices
            };
        } catch (error) {
            console.error('Failed to fetch system rates:', error);
            throw error;
        }
    }
}

module.exports = PricingService;
