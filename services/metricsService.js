// Prometheus Metrics Service for ELIPHASx
const promClient = require('prom-client');

// Create a Registry
const register = new promClient.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
promClient.collectDefaultMetrics({ register });

// Custom Metrics

// HTTP Request Duration
const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});
register.registerMetric(httpRequestDuration);

// HTTP Request Counter
const httpRequestTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
});
register.registerMetric(httpRequestTotal);

// Active Users (Gauge)
const activeUsers = new promClient.Gauge({
    name: 'eliphasx_active_users',
    help: 'Number of active user sessions'
});
register.registerMetric(activeUsers);

// Business Metrics
const quotesCreated = new promClient.Counter({
    name: 'eliphasx_quotes_created_total',
    help: 'Total number of quotes created',
    labelNames: ['organization_id']
});
register.registerMetric(quotesCreated);

const loginsTotal = new promClient.Counter({
    name: 'eliphasx_logins_total',
    help: 'Total number of login attempts',
    labelNames: ['status'] // success, failed
});
register.registerMetric(loginsTotal);

// Middleware to track request metrics
const metricsMiddleware = (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route?.path || req.path || 'unknown';
        const normalizedRoute = route.replace(/\/\d+/g, '/:id'); // Normalize IDs

        httpRequestDuration.labels(req.method, normalizedRoute, res.statusCode).observe(duration);
        httpRequestTotal.labels(req.method, normalizedRoute, res.statusCode).inc();
    });

    next();
};

// Export everything
module.exports = {
    register,
    metricsMiddleware,
    httpRequestDuration,
    httpRequestTotal,
    activeUsers,
    quotesCreated,
    loginsTotal
};
