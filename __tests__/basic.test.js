/**
 * Simple Test to Verify Jest Works
 */

describe('Basic Jest Test', () => {
    test('should pass a simple assertion', () => {
        expect(1 + 1).toBe(2);
    });

    test('should handle boolean assertions', () => {
        expect(true).toBe(true);
    });

    test('should handle string assertions', () => {
        expect('hello').toBe('hello');
    });
});
