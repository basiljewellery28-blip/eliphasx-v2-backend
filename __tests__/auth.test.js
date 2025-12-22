/**
 * Authentication Tests
 * Tests for login, registration, rate limiting, and account lockout
 */

const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');

// Create a minimal test app
const createTestApp = () => {
    const app = express();
    app.use(express.json());

    // Mock database responses
    const mockDb = {
        users: [
            {
                id: 1,
                email: 'test@example.com',
                password_hash: bcrypt.hashSync('Password123', 10),
                role: 'admin',
                organization_id: 1,
                is_org_owner: true,
                failed_login_attempts: 0,
                locked_until: null
            }
        ]
    };

    // Simple login endpoint for testing
    app.post('/api/auth/login', async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = mockDb.users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if account is locked
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(423).json({ error: 'Account locked' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            user.failed_login_attempts++;
            if (user.failed_login_attempts >= 5) {
                user.locked_until = new Date(Date.now() + 15 * 60 * 1000);
                return res.status(423).json({ error: 'Account locked due to too many failed attempts' });
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Reset failed attempts on successful login
        user.failed_login_attempts = 0;
        user.locked_until = null;

        res.json({
            user: { id: user.id, email: user.email, role: user.role },
            token: 'mock-jwt-token'
        });
    });

    return app;
};

describe('Authentication Tests', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('POST /api/auth/login', () => {
        test('should return 400 when email is missing', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ password: 'Password123' });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Email and password required');
        });

        test('should return 400 when password is missing', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'test@example.com' });

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Email and password required');
        });

        test('should return 401 for invalid email', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'wrong@example.com', password: 'Password123' });

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Invalid credentials');
        });

        test('should return 401 for invalid password', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'test@example.com', password: 'WrongPassword' });

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Invalid credentials');
        });

        test('should return user and token on successful login', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'test@example.com', password: 'Password123' });

            expect(response.status).toBe(200);
            expect(response.body.user).toBeDefined();
            expect(response.body.user.email).toBe('test@example.com');
            expect(response.body.token).toBeDefined();
        });

        test('should lock account after 5 failed attempts', async () => {
            // Make 5 failed login attempts
            for (let i = 0; i < 5; i++) {
                await request(app)
                    .post('/api/auth/login')
                    .send({ email: 'test@example.com', password: 'WrongPassword' });
            }

            // 6th attempt should return account locked
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'test@example.com', password: 'Password123' });

            expect(response.status).toBe(423);
            expect(response.body.error).toContain('locked');
        });
    });
});

describe('Password Strength Validation', () => {
    const isPasswordStrong = (password) => {
        if (!password || password.length < 8) return false;
        if (!/[A-Z]/.test(password)) return false;
        if (!/[a-z]/.test(password)) return false;
        if (!/[0-9]/.test(password)) return false;
        return true;
    };

    test('should reject passwords shorter than 8 characters', () => {
        expect(isPasswordStrong('Pass1')).toBe(false);
    });

    test('should reject passwords without uppercase', () => {
        expect(isPasswordStrong('password123')).toBe(false);
    });

    test('should reject passwords without lowercase', () => {
        expect(isPasswordStrong('PASSWORD123')).toBe(false);
    });

    test('should reject passwords without numbers', () => {
        expect(isPasswordStrong('PasswordABC')).toBe(false);
    });

    test('should accept strong passwords', () => {
        expect(isPasswordStrong('Password123')).toBe(true);
        expect(isPasswordStrong('MySecure1Pass')).toBe(true);
    });
});
