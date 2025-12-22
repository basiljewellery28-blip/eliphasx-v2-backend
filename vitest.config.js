import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['**/__tests__/**/*.test.js'],
        exclude: ['**/node_modules/**'],
        coverage: {
            provider: 'v8',
            include: ['routes/**/*.js', 'middleware/**/*.js', 'services/**/*.js']
        }
    }
});
