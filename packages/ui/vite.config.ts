import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5115,
        strictPort: true,
        proxy: {
            '/api/openfigi': {
                target: 'https://api.openfigi.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/openfigi/, ''),
            },
        },
    },
    build: {
        chunkSizeWarningLimit: 1500,
    },
});
