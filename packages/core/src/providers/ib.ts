import { resolveCountry } from '../country-map.js';
import type {
    BrokerProvider,
    BrokerProviderResult,
} from './types.js';
import { parseIBCsv } from '../parsers/ib-csv.js';
import { matchWhtToDividends } from '../parsers/wht-matcher.js';
import { calcDividendTax } from '../tax/rules.js';

export const ibProvider: BrokerProvider = {
    name: 'IB',
    fileHandlers: [
        {
            id: 'ib-activity',
            detectFile(content: string): boolean {
                return content.startsWith('Statement,Header,Field Name');
            },
            parseFile(content: string): BrokerProviderResult {
                const parsed = parseIBCsv(content);

                // Match WHT to dividends and calculate tax
                const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
                const allDividends = [...matched, ...unmatched];

                for (const d of allDividends) {
                    d.country = resolveCountry(d.symbol);
                    const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

                    d.bgTaxDue = bgTaxDue;
                    d.whtCredit = whtCredit;
                }

                return {
                    trades: parsed.trades,
                    dividends: allDividends,
                    interest: parsed.interest,
                    stockYield: parsed.stockYield,
                    openPositions: parsed.openPositions,
                };
            },
        },
    ],
    exportInstructions: [
        {
            label: 'provider.ib.instructions.activity.label',
            steps: [
                'provider.ib.instructions.activity.step1',
                'provider.ib.instructions.activity.step2',
                'provider.ib.instructions.activity.step3',
                'provider.ib.instructions.activity.step4',
            ],
        },
    ],
};
