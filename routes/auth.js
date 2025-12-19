const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const { logAudit, AuditAction } = require('../services/auditService');

// Rate Limiter for Auth Endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many attempts, please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Password validation helper
const isPasswordStrong = (password) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers;
};

// Generate URL-friendly slug from name
const generateSlug = (name) => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .substring(0, 50);
};

router.post('/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const result = await db.query('SELECT * FROM users WHERE email = $1', [xss(email)]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if account is locked
        if (user.locked_until && new Date() < new Date(user.locked_until)) {
            const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
            return res.status(423).json({
                error: `Account is locked. Try again in ${remainingMinutes} minute(s).`
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            // Increment failed attempts
            const newFailedAttempts = (user.failed_login_attempts || 0) + 1;

            if (newFailedAttempts >= 5) {
                // Lock account for 15 minutes
                await db.query(
                    'UPDATE users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL \'15 minutes\' WHERE id = $2',
                    [newFailedAttempts, user.id]
                );
                return res.status(423).json({
                    error: 'Account locked due to too many failed attempts. Try again in 15 minutes.'
                });
            } else {
                await db.query(
                    'UPDATE users SET failed_login_attempts = $1 WHERE id = $2',
                    [newFailedAttempts, user.id]
                );
            }

            // Log failed login attempt
            logAudit({ userId: user.id, organizationId: user.organization_id, action: AuditAction.LOGIN_FAILED, details: { reason: 'invalid_password' }, req });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Reset failed attempts on successful login
        await db.query(
            'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
            [user.id]
        );

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        // Remove sensitive data from response
        delete user.password_hash;
        delete user.failed_login_attempts;
        delete user.locked_until;
        delete user.reset_password_token;
        delete user.reset_password_expires;

        // Log successful login
        logAudit({ userId: user.id, organizationId: user.organization_id, action: AuditAction.LOGIN, details: { email: user.email }, req });

        res.json({ user, token });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.post('/register', authLimiter, async (req, res) => {
    try {
        const {
            email,
            password,
            // Personal info
            firstName,
            lastName,
            phone,
            jobTitle,
            // Organization info
            organizationName,
            companySize,
            industry,
            province,
            // Address (optional)
            addressLine1,
            addressLine2,
            city,
            postalCode,
            registrationNumber,
            vatNumber,
            // Consent
            acceptedTerms,
            acceptedPrivacy
        } = req.body;

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Please provide a valid email address.'
            });
        }

        // Validate password strength
        if (!isPasswordStrong(password)) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters with uppercase, lowercase, and a number.'
            });
        }

        // Check if user exists
        const existingUser = await db.query('SELECT * FROM users WHERE email = $1', [xss(email)]);
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        // Extract company name from email domain or use provided name
        const emailDomain = email.split('@')[1]?.split('.')[0] || 'company';
        const companyName = organizationName || emailDomain.charAt(0).toUpperCase() + emailDomain.slice(1);
        const slug = generateSlug(companyName) + '-' + Date.now().toString(36);

        // Create organization for new user (14-day trial) with full details
        const orgResult = await db.query(
            `INSERT INTO organizations (
                name, slug, plan, subscription_status, trial_ends_at, settings,
                contact_email, phone, address_line1, address_line2, city, province,
                postal_code, country, company_size, industry, registration_number, vat_number
            ) VALUES ($1, $2, 'trial', 'trial', NOW() + INTERVAL '14 days', '{}',
                $3, $4, $5, $6, $7, $8, $9, 'South Africa', $10, $11, $12, $13)
             RETURNING id`,
            [
                xss(companyName),
                slug,
                xss(email),
                xss(phone || ''),
                xss(addressLine1 || ''),
                xss(addressLine2 || ''),
                xss(city || ''),
                xss(province || ''),
                xss(postalCode || ''),
                xss(companySize || ''),
                xss(industry || 'jewellery_manufacturing'),
                xss(registrationNumber || ''),
                xss(vatNumber || '')
            ]
        );
        const organizationId = orgResult.rows[0].id;

        // Create user as org owner with admin role and profile info
        const result = await db.query(
            `INSERT INTO users (
                email, password_hash, role, organization_id, is_org_owner,
                first_name, last_name, phone, job_title, accepted_terms_at, accepted_privacy_at
            ) VALUES ($1, $2, 'admin', $3, true, $4, $5, $6, $7, $8, $9)
             RETURNING id, email, role, organization_id, is_org_owner, first_name, last_name`,
            [
                xss(email),
                hashedPassword,
                organizationId,
                xss(firstName || ''),
                xss(lastName || ''),
                xss(phone || ''),
                xss(jobTitle || ''),
                acceptedTerms ? new Date() : null,
                acceptedPrivacy ? new Date() : null
            ]
        );

        res.status(201).json({
            user: result.rows[0],
            organization: { id: organizationId, name: companyName },
            message: 'Registration successful! Your 14-day trial has started.'
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
});

router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        const result = await db.query('SELECT * FROM users WHERE email = $1', [xss(email)]);
        const user = result.rows[0];

        if (!user) {
            // Do not reveal that user does not exist
            return res.json({ message: 'If an account exists, a reset link has been sent.' });
        }

        // Generate secure token (32 bytes = 64 hex chars)
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hour

        await db.query(
            'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
            [token, expires, user.id]
        );

        // In production: Send email with reset link
        // For development: Log to server console ONLY (never send to client)
        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${token}`;
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[DEV ONLY] Password Reset Link for ${email}: ${resetLink}`);
        }

        res.json({ message: 'If an account exists, a reset link has been sent.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

router.post('/reset-password', authLimiter, async (req, res) => {
    try {
        const { token, password } = req.body;

        // Validate password strength
        if (!isPasswordStrong(password)) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters with uppercase, lowercase, and a number.'
            });
        }

        const result = await db.query(
            'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
            [token]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(400).json({ error: 'Password reset token is invalid or has expired.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await db.query(
            'UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
            [hashedPassword, user.id]
        );

        res.json({ message: 'Password has been changed.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

module.exports = router;
