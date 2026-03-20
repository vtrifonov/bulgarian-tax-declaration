import { PDFParse } from 'pdf-parse';

import type {
    BrokerProvider,
    BrokerProviderResult,
} from './types.js';
import { parseEtradePdf } from '../parsers/etrade-pdf.js';

let workerInitialized = false;

function ensureWorker(): void {
    if (workerInitialized) {
        return;
    }

    // In browser environments, pdfjs-dist needs a worker.
    // PDFParse.setWorker() with no args uses the bundled default in Node.
    // In browser, we point to the pdfjs-dist worker via CDN or local path.
    if (typeof window !== 'undefined') {
        try {
            // Use the worker bundled with pdfjs-dist (resolved by Vite/bundler)
            PDFParse.setWorker(
                new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href,
            );
        } catch {
            // Fallback: disable worker (slower but works)
            PDFParse.setWorker('');
        }
    }
    workerInitialized = true;
}

export const etradeProvider: BrokerProvider = {
    name: 'E*TRADE',
    fileHandlers: [
        {
            id: 'etrade-statement',
            kind: 'binary' as const,
            detectBinary(_buffer: ArrayBuffer, filename: string): boolean {
                return filename.toLowerCase().endsWith('.pdf')
                    && filename.toLowerCase().includes('clientstatement');
            },
            async parseBinary(buffer: ArrayBuffer): Promise<BrokerProviderResult> {
                ensureWorker();
                const parser = new PDFParse({ data: new Uint8Array(buffer) });

                await parser.load();
                const result = await parser.getText();
                const fullText = result.pages.map((p: { text: string }) => p.text).join('\n');

                return parseEtradePdf(fullText);
            },
        },
    ],
    exportInstructions: [
        {
            label: 'provider.etrade.instructions.statement.label',
            steps: [
                'provider.etrade.instructions.statement.step1',
                'provider.etrade.instructions.statement.step2',
                'provider.etrade.instructions.statement.step3',
                'provider.etrade.instructions.statement.step4',
                'provider.etrade.instructions.statement.step5',
                'provider.etrade.instructions.statement.step6',
            ],
        },
    ],
};
