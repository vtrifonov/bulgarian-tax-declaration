import type {
    BrokerProvider,
    BrokerProviderResult,
} from './types.js';
import { parseRevolutCsv } from '../parsers/revolut-csv.js';
import { parseRevolutInvestmentsCsv } from '../parsers/revolut-investments.js';
import type { Trade } from '../types/index.js';

export const revolutProvider: BrokerProvider = {
    name: 'Revolut',
    fileHandlers: [
        {
            id: 'revolut-savings',
            detectFile(content: string, filename: string): boolean {
                return content.includes('Interest PAID') || filename.startsWith('savings-statement');
            },
            parseFile(content: string): BrokerProviderResult {
                const interest = parseRevolutCsv(content);

                return { savingsInterest: interest };
            },
        },
        {
            id: 'revolut-investments',
            detectFile(content: string): boolean {
                const firstLine = content.split('\n')[0] ?? '';

                return firstLine.includes('Date') && firstLine.includes('Ticker') && firstLine.includes('Type');
            },
            parseFile(content: string): BrokerProviderResult {
                const { trades: revTrades } = parseRevolutInvestmentsCsv(content);

                const trades: Trade[] = revTrades.map(t => ({
                    symbol: t.ticker,
                    dateTime: t.date,
                    quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                    price: t.pricePerShare,
                    proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                    commission: 0,
                    currency: t.currency,
                }));

                return { trades };
            },
        },
    ],
    exportInstructions: [
        {
            label: 'provider.revolut.instructions.investments.label',
            steps: [
                'provider.revolut.instructions.investments.step1',
                'provider.revolut.instructions.investments.step2',
                'provider.revolut.instructions.investments.step3',
                'provider.revolut.instructions.investments.step4',
                'provider.revolut.instructions.investments.step5',
                'provider.revolut.instructions.investments.step6',
                'provider.revolut.instructions.investments.step7',
            ],
        },
        {
            label: 'provider.revolut.instructions.savings.label',
            steps: [
                'provider.revolut.instructions.savings.step1',
                'provider.revolut.instructions.savings.step2',
                'provider.revolut.instructions.savings.step3',
                'provider.revolut.instructions.savings.step4',
                'provider.revolut.instructions.savings.step5',
                'provider.revolut.instructions.savings.step6',
                'provider.revolut.instructions.savings.step7',
            ],
        },
    ],
};
