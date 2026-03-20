import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        testTimeout: 15000,
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/types/**'],
            reporter: ['text', 'json-summary'],
            thresholds: process.env.SKIP_COVERAGE_CHECK === '1'
                ? undefined
                : {
                    statements: 70,
                    branches: 70,
                    functions: 70,
                    lines: 70,
                },
        },
    },
});
