const calculateQuote = (quote, systemRates = null) => {
    // Helper to safely parse numbers
    const num = (val) => parseFloat(val) || 0;

    // 1. Metal Calculations
    const metalWeight = num(quote.metal_weight);
    let metalSpotPrice = num(quote.metal_spot_price);

    // Override with system rate ONLY if spot price is not provided (e.g. initial calc)
    if ((!metalSpotPrice || metalSpotPrice === 0) && systemRates && systemRates.metalPrices && quote.metal_type) {
        if (systemRates.metalPrices[quote.metal_type]) {
            metalSpotPrice = parseFloat(systemRates.metalPrices[quote.metal_type]);
        }
    }

    const metalWastage = num(quote.metal_wastage);
    const metalMarkup = num(quote.metal_markup);

    const metalCost = (metalWeight + (metalWeight * (metalWastage / 100))) * metalSpotPrice;
    const metalPrice = metalCost * (1 + (metalMarkup / 100));

    // 2. CAD Calculations
    const cadHours = num(quote.cad_hours);
    const cadBaseRate = num(quote.cad_base_rate);
    const cadRendering = quote.include_rendering_cost !== false ? num(quote.cad_rendering_cost) : 0;
    const cadTechnical = quote.include_technical_cost !== false ? num(quote.cad_technical_cost) : 0;
    const cadMarkup = num(quote.cad_markup);

    const cadCost = (cadHours * cadBaseRate) + cadRendering + cadTechnical;
    const cadPrice = cadCost * (1 + (cadMarkup / 100));

    // 3. Manufacturing Calculations
    const mfgHours = num(quote.manufacturing_hours);
    const mfgBaseRate = num(quote.manufacturing_base_rate);
    const mfgMarkup = num(quote.manufacturing_markup);

    const mfgCost = mfgHours * mfgBaseRate;
    const mfgPrice = mfgCost * (1 + (mfgMarkup / 100));

    // 4. Stones Calculations
    const stones = quote.stone_categories || [];
    const stoneMarkup = num(quote.stone_markup);

    const stoneCost = stones.reduce((total, stone) => {
        const count = num(stone.count);
        const costPerStone = num(stone.cost_per_stone);
        let settingCost = num(stone.setting_cost);

        // Override with system rate ONLY if setting cost is not provided
        if ((!settingCost || settingCost === 0) && systemRates && systemRates.stonePrices && stone.type && stone.setting_style && stone.size_category) {
            const match = systemRates.stonePrices.find(p =>
                p.stone_type === stone.type &&
                p.setting_style === stone.setting_style &&
                p.size_category === stone.size_category
            );
            if (match) {
                settingCost = parseFloat(match.cost);
            }
        }

        return total + (count * (costPerStone + settingCost));
    }, 0);

    const stonePrice = stoneCost * (1 + (stoneMarkup / 100));

    // 5. Finishing Calculations
    const finishCost = num(quote.finishing_cost);
    const platingCost = quote.include_plating_cost !== false ? num(quote.plating_cost) : 0;
    const finishMarkup = num(quote.finishing_markup);

    const finishingCost = finishCost + platingCost;
    const finishingPrice = finishingCost * (1 + (finishMarkup / 100));

    // 6. Findings Calculations
    const findings = quote.findings || [];
    const findingsMarkup = num(quote.findings_markup);

    const findingsCost = findings.reduce((total, finding) => {
        const count = num(finding.count);
        const cost = num(finding.cost);
        return total + (count * cost);
    }, 0);

    const findingsPrice = findingsCost * (1 + (findingsMarkup / 100));

    // Totals
    const subtotalCost = metalCost + cadCost + mfgCost + stoneCost + finishingCost + findingsCost;
    const totalPrice = metalPrice + cadPrice + mfgPrice + stonePrice + finishingPrice + findingsPrice;
    const profit = totalPrice - subtotalCost;
    const margin = totalPrice > 0 ? (profit / totalPrice) * 100 : 0;

    return {
        sections: {
            metal: { cost: metalCost, price: metalPrice, spotPrice: metalSpotPrice },
            cad: { cost: cadCost, price: cadPrice },
            manufacturing: { cost: mfgCost, price: mfgPrice },
            stones: { cost: stoneCost, price: stonePrice },
            finishing: { cost: finishingCost, price: finishingPrice },
            findings: { cost: findingsCost, price: findingsPrice },
        },
        totals: {
            subtotalCost,
            totalPrice,
            profit,
            margin
        }
    };
};

module.exports = {
    calculateQuote
};
