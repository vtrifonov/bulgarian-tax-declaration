import { defineConfig } from 'vitest/config';
import { bundledBnbTemplatePlugin } from './build/bundled-bnb-template-plugin';

export default defineConfig({
    plugins: [bundledBnbTemplatePlugin()],
    test: {
        environment: 'jsdom',
        setupFiles: ['src/test/setup.ts'],
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
});
