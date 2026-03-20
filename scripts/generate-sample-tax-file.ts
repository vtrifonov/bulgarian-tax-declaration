import {
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
    assembleSpb8,
    calcDividendTax,
    FifoEngine,
    type ForeignAccountBalance,
    generateExcel,
    type Holding,
    importFullExcel,
    importHoldingsFromCsv,
    type InterestEntry,
    matchWhtToDividends,
    parseIBCsv,
    parseRevolutAccountStatement,
    parseRevolutCsv,
    parseRevolutInvestmentsCsv,
    resolveCountry,
    splitOpenPositions,
} from '../packages/core/src/index.js';

const SAMPLES = join(process.cwd(), 'samples');
const OUTPUT = join(SAMPLES, 'Данъчна_2025.xlsx');

const FIGI_COUNTRIES: Record<string, string> = {
    GOOG: 'САЩ',
    AMZN: 'САЩ',
    MSFT: 'САЩ',
    META: 'САЩ',
    AAPL: 'САЩ',
    DAL: 'САЩ',
    RIO: 'САЩ',
    COIN: 'САЩ',
    ASML: 'САЩ',
    SAPd: 'Германия',
    SAP: 'Германия',
    '1810': 'Хонконг',
    MONB: 'България',
};

function resolveCountryWithFigi(symbol: string): string {
    return resolveCountry(symbol) || FIGI_COUNTRIES[symbol] || '';
}

function buildCountryMap(symbols: { symbol?: string; ticker?: string }[]): Record<string, string> {
    const map: Record<string, string> = {};

    for (const s of symbols) {
        const sym = s.symbol ?? s.ticker ?? '';

        if (sym) {
            map[sym] = resolveCountryWithFigi(sym);
        }
    }

    return map;
}

function groupInterestByCurrency(
    broker: string,
    entries: InterestEntry[],
) {
    const byCurrency = new Map<string, typeof entries>();

    for (const e of entries) {
        const arr = byCurrency.get(e.currency) ?? [];

        arr.push(e);
        byCurrency.set(e.currency, arr);
    }

    return Array.from(byCurrency.entries()).map(([currency, brokerEntries]) => ({ broker, currency, entries: brokerEntries }));
}

function mergeFifoResultsWithExistingHoldings(
    existingHoldings: Holding[],
    fifoHoldings: Holding[],
    consumedHoldings: Holding[],
): Holding[] {
    const existingIds = new Set(existingHoldings.map(h => h.id));
    const consumedExisting = consumedHoldings.filter(h => existingIds.has(h.id));
    const consumedIds = new Set(consumedExisting.map(h => h.id));
    const updatedById = new Map(
        fifoHoldings.filter(h => existingIds.has(h.id)).map(h => [h.id, h]),
    );
    const survivingOriginals = existingHoldings
        .filter(h => !consumedIds.has(h.id))
        .map(h => updatedById.get(h.id) ?? h);
    const newHoldings = fifoHoldings.filter(h => !existingIds.has(h.id));

    return [...survivingOriginals, ...consumedExisting, ...newHoldings];
}

async function buildSampleState() {
    const initialHoldings = importHoldingsFromCsv(
        readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8'),
    );

    const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
    const parsed = parseIBCsv(ibCsv);
    const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
    const allDividends = [...matched, ...unmatched];

    for (const d of allDividends) {
        d.country = resolveCountryWithFigi(d.symbol);
        const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

        d.bgTaxDue = bgTaxDue;
        d.whtCredit = whtCredit;
    }

    const ibCountryMap = buildCountryMap([
        ...parsed.trades,
        ...parsed.openPositions.map(p => ({ symbol: p.symbol })),
    ]);
    const ibSellTrades = parsed.trades.filter(t => t.quantity < 0);
    const ibFifo = new FifoEngine([...initialHoldings]);
    const { holdings: updatedExistingAfterIb, consumedHoldings: ibConsumed, sales: ibSales } = ibFifo.processTrades(
        ibSellTrades,
        'IB',
        ibCountryMap,
    );
    const ibStatementHoldings = splitOpenPositions(parsed.openPositions, parsed.trades, {
        broker: 'IB',
        countryMap: ibCountryMap,
        taxYear: 2025,
        symbolAliases: parsed.symbolAliases,
        skipPreExisting: true,
        existingHoldings: initialHoldings.map(h => ({ symbol: h.symbol, broker: h.broker })),
    });
    const holdingsAfterIb = [
        ...mergeFifoResultsWithExistingHoldings(initialHoldings, updatedExistingAfterIb, ibConsumed),
        ...ibStatementHoldings,
    ];

    const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
    const { trades: revTrades, holdings: revParsedHoldings } = parseRevolutInvestmentsCsv(investCsv);
    const revCountryMap = buildCountryMap(revTrades.map(t => ({ ticker: t.ticker })));
    const revSellTrades = revTrades
        .filter(t => t.type.includes('SELL'))
        .map(t => ({
            symbol: t.ticker,
            dateTime: t.date,
            quantity: -t.quantity,
            price: t.pricePerShare,
            proceeds: t.totalAmount,
            commission: 0,
            currency: t.currency,
        }));
    const revFifo = new FifoEngine([...holdingsAfterIb]);
    const { holdings: updatedExistingAfterRev, consumedHoldings: revConsumed, sales: revSales } = revFifo.processTrades(
        revSellTrades,
        'Revolut',
        revCountryMap,
    );
    const finalHoldings = [
        ...mergeFifoResultsWithExistingHoldings(holdingsAfterIb, updatedExistingAfterRev, revConsumed),
        ...revParsedHoldings,
    ];

    const eurInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8'));
    const gbpInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8'));
    const revolutAccount = parseRevolutAccountStatement(
        readFileSync(join(SAMPLES, 'revolut-account.csv'), 'utf-8'),
    );
    const ibForeignAccounts: ForeignAccountBalance[] = (parsed.cashBalances ?? []).map(b => ({
        broker: parsed.brokerName ?? 'Interactive Brokers',
        type: '03',
        maturity: 'L',
        country: parsed.brokerName?.includes('Ireland') ? 'IE' : 'US',
        currency: b.currency,
        amountStartOfYear: b.amountStartOfYear,
        amountEndOfYear: b.amountEndOfYear,
    }));

    return {
        taxYear: 2025 as const,
        baseCurrency: 'BGN' as const,
        language: 'bg' as const,
        holdings: finalHoldings,
        sales: [...ibSales, ...revSales],
        dividends: allDividends,
        stockYield: parsed.stockYield,
        brokerInterest: [
            ...groupInterestByCurrency('IB', parsed.interest),
            eurInterest,
            gbpInterest,
        ],
        foreignAccounts: [...ibForeignAccounts, revolutAccount],
        fxRates: {},
        manualEntries: [],
    };
}

async function main() {
    const state = await buildSampleState();
    const buffer = await generateExcel(state);

    writeFileSync(OUTPUT, Buffer.from(buffer));

    const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);
    const sourceSpb8 = assembleSpb8(
        state,
        { name: '', egn: '', address: {}, phone: '', email: '' },
        'P',
    );
    const reimportedSpb8 = assembleSpb8(
        { ...state, ...reimported, foreignAccounts: state.foreignAccounts },
        { name: '', egn: '', address: {}, phone: '', email: '' },
        'P',
    );

    console.log(`Generated ${OUTPUT}`);
    console.log(`Holdings: ${state.holdings.length} -> ${reimported.holdings.length}`);
    console.log(`Sales: ${state.sales.length} -> ${reimported.sales.length}`);
    console.log(`Dividends: ${state.dividends.length} -> ${reimported.dividends.length}`);
    console.log(`Stock yield: ${state.stockYield.length} -> ${reimported.stockYield.length}`);
    console.log(`Broker interest groups: ${state.brokerInterest.length} -> ${reimported.brokerInterest.length}`);
    console.log(`SPB-8 securities: ${sourceSpb8.securities.length} -> ${reimportedSpb8.securities.length}`);
    console.log(`SPB-8 threshold: ${sourceSpb8.thresholdMet} -> ${reimportedSpb8.thresholdMet}`);
    console.log('Note: main Excel import/export does not currently preserve foreignAccounts; SPB-8 comparison reuses source foreignAccounts.');
}

void main();
