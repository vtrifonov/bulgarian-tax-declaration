import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    isBinaryHandler,
    isTextHandler,
    providers,
} from '../../src/index.js';

describe('Provider registry', () => {
    it('exports all registered providers', () => {
        expect(providers.length).toBeGreaterThan(0);
    });

    it('all providers have non-empty fileHandlers', () => {
        for (const p of providers) {
            expect(p.fileHandlers.length).toBeGreaterThan(0);
        }
    });

    it('provider names are unique', () => {
        const names = providers.map(p => p.name);

        expect(new Set(names).size).toBe(names.length);
    });

    it('handler IDs are unique across all providers', () => {
        const ids = providers.flatMap(p => p.fileHandlers.map(h => h.id));

        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('FileHandler detection', () => {
    it('IB: detects by "Statement,Header,Field Name" header', () => {
        const ib = providers.find(p => p.name === 'IB')!;
        const handler = ib.fileHandlers[0];

        expect(handler.detectFile('Statement,Header,Field Name,Field Value\n...', 'report.csv')).toBe(true);
    });

    it('Revolut savings: detects by "Interest PAID" in content', () => {
        const rev = providers.find(p => p.name === 'Revolut')!;
        const handler = rev.fileHandlers.find(h => h.id === 'revolut-savings')!;

        expect(handler.detectFile('Date,Description,"Value, EUR"\n"Dec 31, 2025",Interest PAID EUR Class R,0.32', 'savings.csv')).toBe(true);
    });

    it('Revolut investments: detects by "Date,Ticker,Type" header', () => {
        const rev = providers.find(p => p.name === 'Revolut')!;
        const handler = rev.fileHandlers.find(h => h.id === 'revolut-investments')!;

        expect(handler.detectFile('Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate\n...', 'investments.csv')).toBe(true);
    });

    it('Trading 212: detects by "Action,Time,ISIN,Ticker" header', () => {
        const trading212 = providers.find(p => p.name === 'Trading 212')!;
        const handler = trading212.fileHandlers[0];

        expect(
            handler.detectFile(
                'Action,Time,ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Currency conversion fee,Currency (Currency conversion fee)\n...',
                'statement.csv',
            ),
        ).toBe(true);
    });

    it('returns false for empty file content', () => {
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                if (isTextHandler(h)) {
                    expect(h.detectFile('', 'empty.csv')).toBe(false);
                }
            }
        }
    });

    it('returns false for binary content (no crash)', () => {
        const binaryStr = '\xFF\xD8\xFF\xE0\x00\x10JFIF';
        const buffer = new ArrayBuffer(binaryStr.length);
        const view = new Uint8Array(buffer);

        for (let i = 0; i < binaryStr.length; i++) {
            view[i] = binaryStr.charCodeAt(i);
        }

        for (const p of providers) {
            for (const h of p.fileHandlers) {
                if (isTextHandler(h)) {
                    expect(h.detectFile(binaryStr, 'image.jpg')).toBe(false);
                } else if (isBinaryHandler(h)) {
                    expect(h.detectBinary(buffer, 'image.jpg')).toBe(false);
                }
            }
        }
    });

    it('returns false for generic CSV that matches no provider', () => {
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                if (isTextHandler(h)) {
                    expect(h.detectFile('Name,Age,City\nAlice,30,Sofia', 'data.csv')).toBe(false);
                }
            }
        }
    });

    it('content-based detection works regardless of filename', () => {
        const ib = providers.find(p => p.name === 'IB')!;

        expect(ib.fileHandlers[0].detectFile('Statement,Header,Field Name,Field Value\n...', 'wrong-name.txt')).toBe(true);
    });

    it('first matching handler wins when iterating registry', () => {
        const content = 'Statement,Header,Field Name,Field Value\nStatement,Data,BrokerName,IB';
        let matchCount = 0;

        for (const p of providers) {
            for (const h of p.fileHandlers) {
                if (isTextHandler(h) && h.detectFile(content, 'test.csv')) {
                    matchCount++;
                }
            }
        }
        expect(matchCount).toBe(1);
    });

    it('handles malformed CSV without crashing', () => {
        const malformed = '"unclosed quote,field\n"another,broken';

        for (const p of providers) {
            for (const h of p.fileHandlers) {
                if (isTextHandler(h)) {
                    expect(() => h.detectFile(malformed, 'bad.csv')).not.toThrow();
                }
            }
        }
    });

    it('E*TRADE: detects by filename pattern (*.pdf + clientstatement)', () => {
        const etrade = providers.find(p => p.name === 'E*TRADE')!;
        const handler = etrade.fileHandlers[0];

        expect(isBinaryHandler(handler)).toBe(true);

        if (!isBinaryHandler(handler)) {
            return;
        }
        const buf = new ArrayBuffer(10);

        // Valid filenames
        expect(handler.detectBinary(buf, 'ClientStatements_9999_033125.pdf')).toBe(true);
        expect(handler.detectBinary(buf, 'CLIENTSTATEMENTS_1234.PDF')).toBe(true);
        expect(handler.detectBinary(buf, 'clientstatement_2025.pdf')).toBe(true);

        // Invalid filenames
        expect(handler.detectBinary(buf, 'statement.pdf')).toBe(false);
        expect(handler.detectBinary(buf, 'ClientStatements.txt')).toBe(false);
        expect(handler.detectBinary(buf, 'generic.pdf')).toBe(false);
    });
});
