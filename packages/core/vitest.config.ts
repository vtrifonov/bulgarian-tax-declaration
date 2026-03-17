import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/types/**'],
            reporter: ['text', 'json-summary'],
            thresholds: process.env.SKIP_COVERAGE_CHECK
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
