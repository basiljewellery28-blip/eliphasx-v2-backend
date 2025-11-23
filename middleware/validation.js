const Joi = require('joi');

const quoteValidation = {
    create: Joi.object({
        client_id: Joi.number().integer().required(),
        piece_category: Joi.string().max(100).optional().allow(''),
        brief_id: Joi.string().max(100).optional().allow(''),
        metal_type: Joi.string().max(100).optional().allow(''),
        metal_weight: Joi.number().precision(2).min(0).max(500).optional(),
        metal_wastage: Joi.number().precision(2).min(0).max(50).default(10),
        metal_markup: Joi.number().precision(2).min(0).max(200).default(0),
        design_variations: Joi.array().optional()
    }).unknown(true),

    update: Joi.object({
        metal_type: Joi.string().max(100).optional(),
        metal_weight: Joi.number().precision(2).min(0.1).max(500).optional(),
        metal_wastage: Joi.number().precision(2).min(0).max(50).optional(),
        metal_markup: Joi.number().precision(2).min(0).max(200).optional(),
        cad_hours: Joi.number().precision(2).min(0).max(200).optional(),
        cad_base_rate: Joi.number().precision(2).min(0).max(5000).optional(),
        status: Joi.string().valid('draft', 'completed').optional(),
        // Allow other fields to pass through for now or add them as needed
    }).unknown(true)
};

const clientValidation = {
    create: Joi.object({
        name: Joi.string().max(255).required(),
        company: Joi.string().max(255).required(),
        email: Joi.string().email().optional().allow(''),
        phone: Joi.string().max(50).optional().allow(''),
        pricing_template: Joi.object().optional()
    })
};

const validate = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'Validation failed',
                details: error.details.map(detail => detail.message)
            });
        }
        next();
    };
};

module.exports = {
    quoteValidation,
    clientValidation,
    validate
};
