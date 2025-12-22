/**
 * Test Setup File
 * Runs before each test file
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing';

// Global test timeout
jest.setTimeout(30000);
