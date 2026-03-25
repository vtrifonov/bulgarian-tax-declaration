import { PDFParse } from 'pdf-parse';

import type {
    BrokerProvider,
    BrokerProviderResult,
} from './types.js';
import {
    detectBondoraPdf,
    parseBondoraPdf,
} from '../parsers/bondora-pdf.js';

let workerInitialized = false;

function ensureWorker(): void {
    if (workerInitialized) {
        return;
    }

    if ('window' in globalThis) {
        try {
            PDFParse.setWorker(
                new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href,
            );
        } catch {
            PDFParse.setWorker('');
        }
    }
    workerInitialized = true;
}

export const bondoraProvider: BrokerProvider = {
    name: 'Bondora',
    fileHandlers: [
        {
            id: 'bondora-tax-report',
            kind: 'binary' as const,
            detectBinary(_buffer: ArrayBuffer, filename: string): boolean {
                return filename.toLowerCase().endsWith('.pdf')
                    && filename.toLowerCase().includes('taxreport');
            },
            async parseBinary(buffer: ArrayBuffer): Promise<BrokerProviderResult> {
                ensureWorker();
                const parser = new PDFParse({ data: new Uint8Array(buffer) });
                const result = await parser.getText();
                const fullText = result.pages.map((p: { text: string }) => p.text).join('\n');

                if (!detectBondoraPdf(fullText)) {
                    throw new Error('Not a Bondora Tax Report PDF');
                }

                const { interest, foreignAccount, warnings } = parseBondoraPdf(fullText);

                return {
                    savingsInterest: interest,
                    foreignAccounts: [foreignAccount],
                    warnings,
                };
            },
        },
    ],
    exportInstructions: [
        {
            label: 'provider.bondora.instructions.tax.label',
            steps: [
                'provider.bondora.instructions.tax.step1',
                'provider.bondora.instructions.tax.step2',
                'provider.bondora.instructions.tax.step3',
                'provider.bondora.instructions.tax.step4',
                'provider.bondora.instructions.tax.step5',
            ],
        },
    ],
};
