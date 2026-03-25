import {
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { PDFParse } from 'pdf-parse';

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
    parseEtradePdf,
    parseIBCsv,
    parseRevolutAccountStatement,
    parseRevolutCsv,
    parseRevolutInvestmentsCsv,
    resolveCountry,
    resolveIsinSync,
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
    ASML: 'Нидерландия (Холандия)',
    SAPd: 'Германия',
    SAP: 'Германия',
    '1810': 'Хонконг',
    MONB: 'България',
};

function fillMissingIsins(holdings: Holding[]): void {
    for (const holding of holdings) {
        if (!holding.isin) {
            holding.isin = resolveIsinSync(holding.symbol);
        }
    }
}

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

    fillMissingIsins(holdingsAfterIb);

    const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
    const { trades: revTrades, holdings: revParsedHoldings } = parseRevolutInvestmentsCsv(investCsv);

    fillMissingIsins(revParsedHoldings);
    const revCountryMap = buildCountryMap(revTrades.map(t => ({ ticker: t.ticker })));

    for (const holding of revParsedHoldings) {
        if (!holding.country) {
            holding.country = revCountryMap[holding.symbol] ?? '';
        }
    }

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

    // E*TRADE
    const etradePdfBuf = readFileSync(join(SAMPLES, 'ClientStatements_9999_2025.pdf'));
    const pdfParser = new PDFParse({ data: new Uint8Array(etradePdfBuf) });
    const pdfResult = await pdfParser.getText();
    const etradeText = pdfResult.pages.map((p: { text: string }) => p.text).join('\n');
    const etrade = parseEtradePdf(etradeText);
    const etradeCountryMap = buildCountryMap((etrade.openPositions ?? []).map(p => ({ symbol: p.symbol })));
    const etradeHoldings = splitOpenPositions(etrade.openPositions ?? [], [], {
        broker: 'E*TRADE',
        countryMap: etradeCountryMap,
        taxYear: 2025,
        symbolAliases: {},
        skipPreExisting: true,
        existingHoldings: finalHoldings.map(h => ({ symbol: h.symbol, broker: h.broker })),
    });

    fillMissingIsins(etradeHoldings);

    const finalHoldingsWithEtrade = [
        ...finalHoldings.filter(h => h.source?.type !== 'E*TRADE'),
        ...etradeHoldings,
    ];
    const etradeDividends = (etrade.dividends ?? []).map(d => {
        const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

        return { ...d, country: resolveCountryWithFigi(d.symbol) || 'US', bgTaxDue, whtCredit };
    });

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

    // Load FX rates from existing reference file (already has full year rates)
    const existingRef = readFileSync(join(SAMPLES, 'Данъчна_2025.xlsx'));
    const refImport = await importFullExcel(existingRef.buffer as ArrayBuffer);

    return {
        taxYear: 2025 as const,
        baseCurrency: 'BGN' as const,
        language: 'bg' as const,
        holdings: finalHoldingsWithEtrade,
        sales: [...ibSales, ...revSales],
        dividends: [...allDividends, ...etradeDividends],
        stockYield: parsed.stockYield,
        brokerInterest: [
            gbpInterest,
            eurInterest,
            {
                broker: 'E*TRADE',
                currency: 'USD',
                entries: etrade.interest ?? [],
            },
            ...groupInterestByCurrency('IB', parsed.interest),
        ],
        foreignAccounts: [
            revolutAccount,
            ...ibForeignAccounts,
            ...(etrade.foreignAccounts ?? []),
            { broker: 'Revolut Savings', type: '02' as const, maturity: 'L' as const, country: 'IE', currency: 'GBP', amountStartOfYear: 0, amountEndOfYear: 200 },
            { broker: 'Revolut Savings', type: '02' as const, maturity: 'L' as const, country: 'IE', currency: 'EUR', amountStartOfYear: 0, amountEndOfYear: 300 },
        ],
        yearEndPrices: {
            ...refImport.yearEndPrices,
            // Synthetic prices for securities that need them (matches test buildReferenceSampleState)
            US02079K1079: 178.25, // GOOG
            NL0010273215: 720.00, // ASML
            US5949181045: 420.00, // MSFT
            US2473617023: 55.00, // DAL
            US7672041008: 62.00, // RIO
            US0378331005: 195.00, // AAPL
            KYG9830T1067: 25.00, // 1810
            US19260Q1076: 250.00, // COIN
        },
        fxRates: refImport.fxRates,
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
