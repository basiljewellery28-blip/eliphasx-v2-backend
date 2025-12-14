const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API server, enable for SSR apps
    crossOriginEmbedderPolicy: false, // Required for PDF downloads
}));

// CORS Configuration - Restrict to known origins
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body Parsing with size limit
app.use(express.json({ limit: '2mb' }));

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

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

app.listen(PORT, () => {
    console.log(`ELIPHASx server running on port ${PORT}`);
});
