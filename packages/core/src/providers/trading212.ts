import { resolveCountry } from '../country-map.js';
import type { BrokerProvider } from './types.js';
import {
    isTrading212Csv,
    parseTrading212Csv,
} from '../parsers/trading212.js';
import { calcDividendTax } from '../tax/rules.js';

export const trading212Provider: BrokerProvider = {
    name: 'Trading 212',
    fileHandlers: [
        {
            id: 'trading212-statement',
            kind: 'text' as const,
            detectFile(content: string): boolean {
                return isTrading212Csv(content);
            },
            parseFile(content: string) {
                const parsed = parseTrading212Csv(content);

                for (const dividend of parsed.dividends) {
                    dividend.country = resolveCountry(dividend.symbol);
                    const { bgTaxDue, whtCredit } = calcDividendTax(dividend.grossAmount, dividend.withholdingTax);

                    dividend.bgTaxDue = bgTaxDue;
                    dividend.whtCredit = whtCredit;
                }

                return parsed;
            },
        },
    ],
    exportInstructions: [
        {
            label: 'provider.trading212.instructions.label',
            steps: [
                'provider.trading212.instructions.step1',
                'provider.trading212.instructions.step2',
                'provider.trading212.instructions.step3',
                'provider.trading212.instructions.step4',
                'provider.trading212.instructions.step5',
            ],
        },
    ],
};
