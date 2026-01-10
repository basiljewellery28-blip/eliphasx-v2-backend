const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const Sentry = require('@sentry/node');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Initialize Sentry for error tracking
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0.1, // Capture 10% of transactions for performance monitoring
        integrations: [
            Sentry.httpIntegration({ tracing: true }),
            Sentry.expressIntegration({ app: undefined }) // Will be set after app creation
        ],
    });
    console.log('🔍 Sentry error tracking initialized');
}

// Import metrics service
const { register, metricsMiddleware } = require('./services/metricsService');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy - required for express-rate-limit behind nginx
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API server, enable for SSR apps
    crossOriginEmbedderPolicy: false, // Required for PDF downloads
}));

// CORS Configuration - Restrict to known origins
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    'https://basilx.co.za',
    'https://www.basilx.co.za'
].filter(Boolean);

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (same-origin requests, nginx proxy, mobile apps)
        // This is safe because authentication is handled by JWT, not CORS
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body Parsing with size limit
app.use(express.json({ limit: '2mb' }));

// 🛡️ Global Rate Limiting - prevent API abuse
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // 200 requests per 15 min per IP
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health' // Don't limit health checks
});
app.use('/api/', globalLimiter);

// Prometheus metrics middleware - track all requests
app.use(metricsMiddleware);
// Serve uploaded files (logos, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/search', require('./routes/search'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/sysadmin', require('./routes/sysadmin')); // 🛡️ Super Admin Routes
app.use('/api/branches', require('./routes/branches')); // 🌳 Multi-Branch Support

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// 🛡️ Prometheus metrics endpoint (restricted to internal/localhost only)
app.get('/metrics', (req, res, next) => {
    // Get client IP (behind proxy)
    const clientIP = req.ip || req.connection.remoteAddress || '';
    const isLocalhost = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';
    const isInternal = clientIP.startsWith('10.') || clientIP.startsWith('172.') || clientIP.startsWith('192.168.');

    if (!isLocalhost && !isInternal) {
        console.warn(`🚫 Blocked metrics access from: ${clientIP}`);
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
}, async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// Sentry error handler - must be before any other error middleware
if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
}

// Generic error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { details: err.message })
    });
});

app.listen(PORT, () => {
    console.log(`ELIPHASx server running on port ${PORT}`);
    if (process.env.SENTRY_DSN) {
        console.log('🔍 Sentry error tracking active');
    }
});
