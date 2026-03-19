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
            '/api/stooq': {
                target: 'https://stooq.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/stooq/, ''),
            },
            '/api/twelvedata': {
                target: 'https://api.twelvedata.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/twelvedata/, ''),
            },
            '/api/yahoo': {
                target: 'https://query1.finance.yahoo.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
            },
        },
    },
    build: {
        chunkSizeWarningLimit: 1500,
    },
});
