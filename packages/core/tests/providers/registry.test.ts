import {
    describe,
    expect,
    it,
} from 'vitest';

import { providers } from '../../src/providers/registry.js';

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

    it('returns false for empty file content', () => {
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(h.detectFile('', 'empty.csv')).toBe(false);
            }
        }
    });

    it('returns false for binary content (no crash)', () => {
        const binary = '\xFF\xD8\xFF\xE0\x00\x10JFIF';

        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(h.detectFile(binary, 'image.jpg')).toBe(false);
            }
        }
    });

    it('returns false for generic CSV that matches no provider', () => {
        for (const p of providers) {
            for (const h of p.fileHandlers) {
                expect(h.detectFile('Name,Age,City\nAlice,30,Sofia', 'data.csv')).toBe(false);
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
                if (h.detectFile(content, 'test.csv')) {
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
                expect(() => h.detectFile(malformed, 'bad.csv')).not.toThrow();
            }
        }
    });
});
