import {
    defineConfig,
    type Plugin,
} from 'vite';
import react from '@vitejs/plugin-react';
import { bundledBnbTemplatePlugin } from './build/bundled-bnb-template-plugin';

/** Tauri plugins are only available inside the Tauri desktop shell.
 *  In browser-only dev mode, resolve them to empty stubs so Vite doesn't error. */
const TAURI_ONLY_MODULES = ['@tauri-apps/plugin-shell'];

function tauriStubPlugin(): Plugin {
    return {
        name: 'tauri-stub',
        enforce: 'pre',
        resolveId(id) {
            if (TAURI_ONLY_MODULES.includes(id)) {
                return `\0tauri-stub:${id}`;
            }
        },
        load(id) {
            if (id.startsWith('\0tauri-stub:')) {
                return 'export default {}; export const Command = undefined;';
            }
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tauriStubPlugin(), bundledBnbTemplatePlugin()],
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
    optimizeDeps: {
        exclude: ['@tauri-apps/plugin-shell'],
    },
    build: {
        chunkSizeWarningLimit: 1500,
    },
});
