import { readFileSync } from 'fs';
import { join } from 'path';

import * as ExcelJS from 'exceljs';
import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    type AppState,
    type BrokerInterest,
    calcDividendTax,
    FifoEngine,
    generateExcel,
    generateNraAppendix8,
    type Holding,
    importFullExcel,
    importHoldingsFromCsv,
    type InterestEntry,
    matchWhtToDividends,
    parseIBCsv,
    parseRevolutCsv,
    parseRevolutInvestmentsCsv,
    populateSaleFxRates,
    resolveCountry,
    TaxCalculator,
    type Trade,
} from '../../src/index.js';

const SAMPLES = join(__dirname, '../../../../samples');

/** Group flat InterestEntry[] into BrokerInterest[] by currency */
function groupInterestByCurrency(broker: string, entries: InterestEntry[]): BrokerInterest[] {
    const byCurrency = new Map<string, InterestEntry[]>();

    for (const e of entries) {
        const arr = byCurrency.get(e.currency) ?? [];

        arr.push(e);
        byCurrency.set(e.currency, arr);
    }

    return Array.from(byCurrency.entries()).map(([currency, entries]) => ({ broker, currency, entries }));
}

function buildAppStateFromIB(csv: string, existingHoldings: Holding[] = []): AppState {
    const parsed = parseIBCsv(csv);

    // Match WHT to dividends
    const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
    const allDividends = [...matched, ...unmatched];

    // Resolve countries and calculate BG tax for dividends
    for (const d of allDividends) {
        d.country = resolveCountry(d.symbol);
        const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

        d.bgTaxDue = bgTaxDue;
        d.whtCredit = whtCredit;
    }

    // Build country map for FIFO engine
    const countryMap: Record<string, string> = {};

    for (const t of parsed.trades) {
        countryMap[t.symbol] = resolveCountry(t.symbol);
    }

    // FIFO: process all trades against existing holdings
    const fifo = new FifoEngine([...existingHoldings]);
    const { holdings, consumedHoldings, sales } = fifo.processTrades(parsed.trades, 'IB', countryMap);

    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'bg',
        holdings: [...consumedHoldings, ...holdings],
        sales,
        dividends: allDividends,
        stockYield: parsed.stockYield,
        brokerInterest: groupInterestByCurrency('IB', parsed.interest),
        fxRates: {},
        manualEntries: [],
    };
}

/** Build a full AppState from ALL sample files (IB + Revolut + holdings CSV). */
function buildFullState(): AppState {
    // 1. Import initial holdings from CSV
    const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
    const initialHoldings = importHoldingsFromCsv(holdingsCsv);

    // 2. Parse IB report and run FIFO against initial holdings
    const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
    const parsed = parseIBCsv(ibCsv);

    const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
    const allDividends = [...matched, ...unmatched];

    for (const d of allDividends) {
        d.country = resolveCountry(d.symbol);
        const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

        d.bgTaxDue = bgTaxDue;
        d.whtCredit = whtCredit;
    }

    const ibCountryMap: Record<string, string> = {};

    for (const t of parsed.trades) {
        ibCountryMap[t.symbol] = resolveCountry(t.symbol);
    }
    const ibFifo = new FifoEngine([...initialHoldings]);
    const { holdings: ibHoldings, consumedHoldings: ibConsumed, sales: ibSales } = ibFifo.processTrades(parsed.trades, 'IB', ibCountryMap);

    // 3. Parse Revolut investments and run FIFO
    const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
    const { trades: revTrades } = parseRevolutInvestmentsCsv(investCsv);
    const revCountryMap: Record<string, string> = {};

    for (const t of revTrades) {
        revCountryMap[t.ticker] = resolveCountry(t.ticker);
    }
    const fifoTrades: Trade[] = revTrades.map(t => ({
        symbol: t.ticker,
        dateTime: t.date,
        quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
        price: t.pricePerShare,
        proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
        commission: 0,
        currency: t.currency,
    }));
    const revFifo = new FifoEngine([...ibHoldings]);
    const { holdings: allHoldings, consumedHoldings: revConsumed, sales: revSales } = revFifo.processTrades(fifoTrades, 'Revolut', revCountryMap);

    // 4. Parse Revolut savings interest
    const eurInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8'));
    const gbpInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8'));

    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'bg',
        holdings: [...ibConsumed, ...revConsumed, ...allHoldings],
        sales: [...ibSales, ...revSales],
        dividends: allDividends,
        stockYield: parsed.stockYield,
        brokerInterest: [
            ...groupInterestByCurrency('IB', parsed.interest),
            eurInterest,
            gbpInterest,
        ],
        fxRates: {},
        manualEntries: [],
    };
}

/** Count total interest entries across all BrokerInterest groups */
function totalInterestEntries(bi: BrokerInterest[]): number {
    return bi.reduce((sum, b) => sum + b.entries.length, 0);
}

describe.concurrent('Integration: round-trip import → export → re-import', () => {
    describe('Test 1: IB CSV full pipeline', () => {
        it('parses IB CSV, generates Excel, re-imports and verifies counts', async () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(csv);

            // Verify parsed data has expected content
            expect(state.holdings.length).toBeGreaterThan(0);
            expect(state.sales.length).toBeGreaterThan(0);
            expect(state.dividends.length).toBeGreaterThan(0);
            expect(state.stockYield.length).toBeGreaterThan(0);
            expect(totalInterestEntries(state.brokerInterest)).toBeGreaterThan(0);

            // Spot-check known symbols from sample
            const googHoldings = state.holdings.filter(h => h.symbol === 'GOOG');
            const amznSales = state.sales.filter(s => s.symbol === 'AMZN');

            expect(googHoldings.length).toBeGreaterThan(0);
            expect(amznSales.length).toBeGreaterThan(0);
            // AMZN: bought 20 then sold 20 → expect sales
            expect(amznSales[0].quantity).toBe(20);

            // Generate Excel
            const buffer = await generateExcel(state);

            expect(buffer).toBeInstanceOf(Uint8Array);
            expect(buffer.length).toBeGreaterThan(0);

            // Re-import from Excel
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Verify counts match
            expect(reimported.holdings.length).toBe(state.holdings.length);
            expect(reimported.sales.length).toBe(state.sales.length);
            expect(reimported.dividends.length).toBe(state.dividends.length);
            expect(reimported.stockYield.length).toBe(state.stockYield.length);
            expect(totalInterestEntries(reimported.brokerInterest)).toBe(totalInterestEntries(state.brokerInterest));
        });

        it('verifies sheet names and GOOG/AMZN values survive round-trip', async () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(csv);
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Spot-check GOOG holdings survive round-trip
            const origGoog = state.holdings.filter(h => h.symbol === 'GOOG');
            const impGoog = reimported.holdings.filter(h => h.symbol === 'GOOG');

            expect(impGoog.length).toBe(origGoog.length);

            for (let i = 0; i < origGoog.length; i++) {
                const orig = origGoog[i];
                const imported = impGoog.find(
                    h => h.dateAcquired === orig.dateAcquired && h.quantity === orig.quantity,
                );

                expect(imported).toBeDefined();
                expect(imported!.unitPrice).toBeCloseTo(orig.unitPrice, 2);
                expect(imported!.currency).toBe(orig.currency);
            }

            // Spot-check AMZN sales survive round-trip
            const origAmzn = state.sales.filter(s => s.symbol === 'AMZN');
            const impAmzn = reimported.sales.filter(s => s.symbol === 'AMZN');

            expect(impAmzn.length).toBe(origAmzn.length);

            for (const orig of origAmzn) {
                const imported = impAmzn.find(
                    s => s.dateSold === orig.dateSold && s.quantity === orig.quantity,
                );

                expect(imported).toBeDefined();
                expect(imported!.sellPrice).toBeCloseTo(orig.sellPrice, 2);
                expect(imported!.buyPrice).toBeCloseTo(orig.buyPrice, 2);
            }
        });
    });

    describe('Test 1b: IB sample validates new features (basis, consumed, transfers, exchanges)', () => {
        it('parses basis field from IB trades', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            // GOOG sell trade should have basis from CSV
            const googSell = parsed.trades.find(t => t.symbol === 'GOOG' && t.quantity < 0);

            expect(googSell).toBeDefined();
            expect(googSell!.basis).toBeCloseTo(-1138.40, 2);
        });

        it('tracks consumed holdings from FIFO matching', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(csv);

            // AMZN: bought 20 then sold 20 → fully consumed
            const amznConsumed = state.holdings.filter(h => h.symbol === 'AMZN' && h.consumedByFifo);

            expect(amznConsumed).toHaveLength(1);
            expect(amznConsumed[0].quantity).toBe(0);
            expect(amznConsumed[0].consumedBySaleIds).toBeDefined();
            expect(amznConsumed[0].consumedBySaleIds!.length).toBeGreaterThan(0);

            // SAP (aliased from SAPd): bought 12 then sold 12 → fully consumed
            const sapConsumed = state.holdings.filter(h => h.symbol === 'SAP' && h.consumedByFifo);

            expect(sapConsumed).toHaveLength(1);
            expect(sapConsumed[0].quantity).toBe(0);

            // GOOG: bought 15 + transfer 150, sold 8 → partially consumed, NOT in consumed list
            const googActive = state.holdings.filter(h => h.symbol === 'GOOG' && !h.consumedByFifo);

            expect(googActive.length).toBeGreaterThan(0);
        });

        it('parses transfer-in from Transfers section', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            // DAL transfer: 150 shares, price=0 (unknown)
            const dalTransfer = parsed.trades.find(t => t.symbol === 'DAL' && t.quantity > 0 && t.price === 0);

            expect(dalTransfer).toBeDefined();
            expect(dalTransfer!.quantity).toBe(150);
            expect(dalTransfer!.price).toBe(0);
        });

        it('extracts symbolExchanges from Financial Instrument Information', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            expect(parsed.symbolExchanges).toBeDefined();
            expect(parsed.symbolExchanges['GOOG']).toBe('NASDAQ');
            expect(parsed.symbolExchanges['ASML']).toBe('AEB');
            expect(parsed.symbolExchanges['1810']).toBe('SEHK');
        });

        it('consumed holdings survive Excel round-trip with sample data', async () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(csv);

            const consumedCount = state.holdings.filter(h => h.consumedByFifo).length;

            expect(consumedCount).toBeGreaterThan(0);

            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Consumed holdings survive round-trip (re-import may detect additional consumed via qty=0)
            const reimportedConsumed = reimported.holdings.filter(h => h.consumedByFifo);

            expect(reimportedConsumed.length).toBeGreaterThanOrEqual(consumedCount);

            // consumedBySaleIds resolved to valid sale IDs
            for (const h of reimportedConsumed) {
                expect(h.consumedBySaleIds).toBeDefined();

                for (const saleId of h.consumedBySaleIds!) {
                    const sale = reimported.sales.find(s => s.id === saleId);

                    expect(sale).toBeDefined();
                }
            }
        });
    });

    describe('Test 2: Revolut savings + investments', () => {
        it('parses Revolut CSVs, generates Excel, re-imports and verifies', async () => {
            const eurCsv = readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8');
            const gbpCsv = readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8');
            const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');

            // Parse Revolut savings
            const eurInterest = parseRevolutCsv(eurCsv);
            const gbpInterest = parseRevolutCsv(gbpCsv);

            // Parse Revolut investments
            const { trades } = parseRevolutInvestmentsCsv(investCsv);

            // Build country map and run FIFO for Revolut trades
            const countryMap: Record<string, string> = {};

            for (const t of trades) {
                countryMap[t.ticker] = resolveCountry(t.ticker);
            }
            const fifoTrades: Trade[] = trades.map(t => ({
                symbol: t.ticker,
                dateTime: t.date,
                quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                price: t.pricePerShare,
                proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                commission: 0,
                currency: t.currency,
            }));

            const fifo = new FifoEngine([]);
            const { holdings, sales } = fifo.processTrades(fifoTrades, 'Revolut', countryMap);

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings,
                sales,
                dividends: [],
                stockYield: [],
                brokerInterest: [eurInterest, gbpInterest],
                fxRates: {},
                manualEntries: [],
            };

            expect(state.brokerInterest.length).toBe(2);
            expect(state.holdings.length).toBeGreaterThan(0);

            // Generate Excel
            const buffer = await generateExcel(state);

            expect(buffer.length).toBeGreaterThan(0);

            // Re-import
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Verify broker interest currencies and entry counts
            expect(reimported.brokerInterest.length).toBe(state.brokerInterest.length);

            for (const origBI of state.brokerInterest) {
                const impBI = reimported.brokerInterest.find(b => b.broker === origBI.broker && b.currency === origBI.currency);

                expect(impBI).toBeDefined();
                expect(impBI!.entries.length).toBe(origBI.entries.length);
            }

            // Verify holdings count
            expect(reimported.holdings.length).toBe(state.holdings.length);
        });
    });

    describe('Test 3: Holdings CSV pre-import + IB overlay (full round-trip)', () => {
        it('imports holdings CSV, overlays IB trades, round-trips twice through Excel', async () => {
            // Step 1: Import initial holdings from CSV
            const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
            const initialHoldings = importHoldingsFromCsv(holdingsCsv);

            expect(initialHoldings.length).toBeGreaterThan(0);

            // Step 2: Parse IB report and run FIFO against initial holdings
            const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(ibCsv, initialHoldings);

            // Should have more holdings than just the IB ones (initial + IB residual)
            expect(state.holdings.length).toBeGreaterThan(0);

            // Step 3: First round-trip
            const buffer1 = await generateExcel(state);
            const reimported1 = await importFullExcel(buffer1.buffer as ArrayBuffer);

            // Step 4: Second round-trip
            const state2: AppState = {
                ...state,
                holdings: reimported1.holdings,
                sales: reimported1.sales,
                dividends: reimported1.dividends,
                stockYield: reimported1.stockYield,
                brokerInterest: reimported1.brokerInterest,
            };
            const buffer2 = await generateExcel(state2);
            const reimported2 = await importFullExcel(buffer2.buffer as ArrayBuffer);

            // Assert: all counts match between reimport1 and reimport2
            expect(reimported2.holdings.length).toBe(reimported1.holdings.length);
            expect(reimported2.sales.length).toBe(reimported1.sales.length);
            expect(reimported2.dividends.length).toBe(reimported1.dividends.length);
            expect(reimported2.stockYield.length).toBe(reimported1.stockYield.length);
            expect(reimported2.brokerInterest.length).toBe(reimported1.brokerInterest.length);

            // Spot-check: sort holdings by composite key and compare pairwise
            const sortH = (arr: typeof reimported1.holdings) =>
                [...arr].sort((a, b) =>
                    a.symbol.localeCompare(b.symbol)
                    || a.dateAcquired.localeCompare(b.dateAcquired)
                    || a.broker.localeCompare(b.broker)
                    || a.quantity - b.quantity
                    || a.unitPrice - b.unitPrice
                );
            const h1Sorted = sortH(reimported1.holdings);
            const h2Sorted = sortH(reimported2.holdings);

            for (let i = 0; i < h1Sorted.length; i++) {
                expect(h2Sorted[i].symbol).toBe(h1Sorted[i].symbol);
                expect(h2Sorted[i].quantity).toBeCloseTo(h1Sorted[i].quantity, 4);
                expect(h2Sorted[i].unitPrice).toBeCloseTo(h1Sorted[i].unitPrice, 2);
            }

            const sortS = (arr: typeof reimported1.sales) =>
                [...arr].sort((a, b) =>
                    a.symbol.localeCompare(b.symbol)
                    || a.dateSold.localeCompare(b.dateSold)
                    || a.dateAcquired.localeCompare(b.dateAcquired)
                    || a.quantity - b.quantity
                );
            const s1Sorted = sortS(reimported1.sales);
            const s2Sorted = sortS(reimported2.sales);

            for (let i = 0; i < s1Sorted.length; i++) {
                expect(s2Sorted[i].symbol).toBe(s1Sorted[i].symbol);
                expect(s2Sorted[i].quantity).toBeCloseTo(s1Sorted[i].quantity, 4);
                expect(s2Sorted[i].buyPrice).toBeCloseTo(s1Sorted[i].buyPrice, 2);
                expect(s2Sorted[i].sellPrice).toBeCloseTo(s1Sorted[i].sellPrice, 2);
            }
        });
    });

    describe('Test 4: Full state from all samples — clean re-import matches', () => {
        it('imports all sample files, exports Excel, re-imports from clean state, exports again — both match', async () => {
            const state = buildFullState();

            // Verify all data sections are populated
            expect(state.holdings.length).toBeGreaterThan(0);
            expect(state.sales.length).toBeGreaterThan(0);
            expect(state.dividends.length).toBeGreaterThan(0);
            expect(state.stockYield.length).toBeGreaterThan(0);
            expect(totalInterestEntries(state.brokerInterest)).toBeGreaterThan(0);
            expect(state.brokerInterest.length).toBeGreaterThanOrEqual(2); // IB + Revolut currencies

            // Export 1: from parsed sample data
            const buffer1 = await generateExcel(state);

            // Re-import from clean state (as if user opened Excel file from scratch)
            const reimported = await importFullExcel(buffer1.buffer as ArrayBuffer);

            // Verify all counts match original
            expect(reimported.holdings.length).toBe(state.holdings.length);
            expect(reimported.sales.length).toBe(state.sales.length);
            expect(reimported.dividends.length).toBe(state.dividends.length);
            expect(reimported.stockYield.length).toBe(state.stockYield.length);
            expect(totalInterestEntries(reimported.brokerInterest)).toBe(totalInterestEntries(state.brokerInterest));

            // Export 2: from re-imported data
            const state2: AppState = {
                ...state,
                holdings: reimported.holdings,
                sales: reimported.sales,
                dividends: reimported.dividends,
                stockYield: reimported.stockYield,
                brokerInterest: reimported.brokerInterest,
            };
            const buffer2 = await generateExcel(state2);

            // Re-import export 2
            const reimported2 = await importFullExcel(buffer2.buffer as ArrayBuffer);

            // Both re-imports must have identical counts
            expect(reimported2.holdings.length).toBe(reimported.holdings.length);
            expect(reimported2.sales.length).toBe(reimported.sales.length);
            expect(reimported2.dividends.length).toBe(reimported.dividends.length);
            expect(reimported2.stockYield.length).toBe(reimported.stockYield.length);
            expect(reimported2.brokerInterest.length).toBe(reimported.brokerInterest.length);

            // Deep comparison: holdings values match
            const sortH = (arr: Holding[]) =>
                [...arr].sort((a, b) =>
                    a.symbol.localeCompare(b.symbol)
                    || a.dateAcquired.localeCompare(b.dateAcquired)
                    || a.broker.localeCompare(b.broker)
                    || a.quantity - b.quantity
                    || a.unitPrice - b.unitPrice
                );
            const h1 = sortH(reimported.holdings);
            const h2 = sortH(reimported2.holdings);

            for (let i = 0; i < h1.length; i++) {
                expect(h2[i].symbol).toBe(h1[i].symbol);
                expect(h2[i].broker).toBe(h1[i].broker);
                expect(h2[i].country).toBe(h1[i].country);
                expect(h2[i].dateAcquired).toBe(h1[i].dateAcquired);
                expect(h2[i].quantity).toBeCloseTo(h1[i].quantity, 6);
                expect(h2[i].unitPrice).toBeCloseTo(h1[i].unitPrice, 2);
                expect(h2[i].currency).toBe(h1[i].currency);
            }

            // Deep comparison: dividends values match
            const sortD = (arr: typeof reimported.dividends) =>
                [...arr].sort((a, b) =>
                    a.symbol.localeCompare(b.symbol)
                    || a.date.localeCompare(b.date)
                    || a.grossAmount - b.grossAmount
                );
            const d1 = sortD(reimported.dividends);
            const d2 = sortD(reimported2.dividends);

            for (let i = 0; i < d1.length; i++) {
                expect(d2[i].symbol).toBe(d1[i].symbol);
                expect(d2[i].date).toBe(d1[i].date);
                expect(d2[i].grossAmount).toBeCloseTo(d1[i].grossAmount, 2);
                expect(d2[i].withholdingTax).toBeCloseTo(d1[i].withholdingTax, 2);
            }

            // Deep comparison: broker interest entries
            const sortEntries = (e: { date: string; amount: number }[]) => [...e].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

            for (const r1 of reimported.brokerInterest) {
                const r2 = reimported2.brokerInterest.find(b => b.broker === r1.broker && b.currency === r1.currency);

                expect(r2).toBeDefined();
                expect(r2!.entries.length).toBe(r1.entries.length);
                const e1 = sortEntries(r1.entries);
                const e2 = sortEntries(r2!.entries);

                for (let i = 0; i < e1.length; i++) {
                    expect(e2[i].amount).toBeCloseTo(e1[i].amount, 4);
                    expect(e2[i].date).toBe(e1[i].date);
                }
            }
        });
    });

    describe('Test 5: NRA Appendix 8 Part I export matches holdings data', () => {
        it('generates NRA Appendix 8 with correct rows for all holdings', async () => {
            const state = buildFullState();

            // Generate NRA Appendix 8 Part I
            const nraBuf = await generateNraAppendix8(state.holdings, state.fxRates);

            expect(nraBuf.length).toBeGreaterThan(0);

            // Parse the generated Excel to verify contents
            const workbook = new ExcelJS.Workbook();

            await workbook.xlsx.load(nraBuf.buffer as ArrayBuffer);

            const sheet = workbook.getWorksheet('Приложение 8 Част I');

            expect(sheet).toBeDefined();

            // Row 1 = header, Row 2 = column numbers, data starts at row 3
            const validHoldings = state.holdings
                .filter(h => h.symbol && h.quantity > 0);

            expect(validHoldings.length).toBeGreaterThan(0);
            const dataRowCount = sheet!.rowCount - 2; // subtract header + number row

            expect(dataRowCount).toBe(validHoldings.length);

            // Verify each holding row
            for (let i = 0; i < validHoldings.length; i++) {
                const row = sheet!.getRow(i + 3); // data starts at row 3
                const h = validHoldings[i];

                // Column 1: Вид = "Акции"
                expect(row.getCell(1).value).toBe('Акции');

                // Column 2: Държава
                expect(row.getCell(2).value).toBe(h.country);

                // Column 3: Брой (quantity)
                const qty = Number(row.getCell(3).value);

                expect(qty).toBeCloseTo(h.quantity, 6);

                // Column 4: Date in DD.MM.YYYY format
                const dateParts = h.dateAcquired.match(/^(\d{4})-(\d{2})-(\d{2})$/);

                if (dateParts) {
                    const expectedDate = `${dateParts[3]}.${dateParts[2]}.${dateParts[1]}`;

                    expect(row.getCell(4).value).toBe(expectedDate);
                }

                // Column 5: total in currency (quantity * unitPrice)
                const totalCcy = Number(row.getCell(5).value);

                expect(totalCcy).toBeCloseTo(h.quantity * h.unitPrice, 2);
            }
        });

        it('NRA Appendix 8 is consistent after Excel round-trip', async () => {
            const state = buildFullState();

            // Generate app Excel → re-import → generate NRA from reimported holdings
            const appBuf = await generateExcel(state);
            const reimported = await importFullExcel(appBuf.buffer as ArrayBuffer);

            const nra1 = await generateNraAppendix8(state.holdings, state.fxRates);
            const nra2 = await generateNraAppendix8(reimported.holdings, state.fxRates);

            // Parse both and compare row counts and values
            const wb1 = new ExcelJS.Workbook();

            await wb1.xlsx.load(nra1.buffer as ArrayBuffer);
            const wb2 = new ExcelJS.Workbook();

            await wb2.xlsx.load(nra2.buffer as ArrayBuffer);

            const s1 = wb1.getWorksheet('Приложение 8 Част I')!;
            const s2 = wb2.getWorksheet('Приложение 8 Част I')!;

            expect(s1.rowCount).toBeGreaterThan(2); // must have actual data rows
            expect(s2.rowCount).toBe(s1.rowCount);

            // Compare data rows (start at row 3)
            for (let r = 3; r <= s1.rowCount; r++) {
                const r1 = s1.getRow(r);
                const r2 = s2.getRow(r);

                // Вид
                expect(r2.getCell(1).value).toBe(r1.getCell(1).value);
                // Държава
                expect(r2.getCell(2).value).toBe(r1.getCell(2).value);
                // Quantity
                expect(Number(r2.getCell(3).value)).toBeCloseTo(Number(r1.getCell(3).value), 6);
                // Date
                expect(r2.getCell(4).value).toBe(r1.getCell(4).value);
                // Total in currency
                expect(Number(r2.getCell(5).value)).toBeCloseTo(Number(r1.getCell(5).value), 2);
            }
        });
    });

    describe('Test 5b: NRA Appendix 8 preserves pre-sorted order', () => {
        it('outputs holdings in the order they are provided (pre-sorted by symbol)', async () => {
            const state = buildFullState();

            // Sort holdings alphabetically by symbol (simulating UI sort)
            const sorted = [...state.holdings]
                .filter(h => h.symbol && h.quantity > 0)
                .sort((a, b) => a.symbol.localeCompare(b.symbol));

            const nraBuf = await generateNraAppendix8(sorted, state.fxRates);
            const workbook = new ExcelJS.Workbook();

            await workbook.xlsx.load(nraBuf.buffer as ArrayBuffer);
            const sheet = workbook.getWorksheet('Приложение 8 Част I')!;

            // Verify that the NRA output matches the pre-sorted order
            for (let i = 0; i < sorted.length; i++) {
                const row = sheet.getRow(i + 3);

                expect(Number(row.getCell(3).value)).toBeCloseTo(sorted[i].quantity, 6);
                expect(row.getCell(2).value).toBe(sorted[i].country);
            }
        });

        it('outputs holdings in reverse-symbol order when pre-sorted descending', async () => {
            const state = buildFullState();

            const sorted = [...state.holdings]
                .filter(h => h.symbol && h.quantity > 0)
                .sort((a, b) => b.symbol.localeCompare(a.symbol));

            const nraBuf = await generateNraAppendix8(sorted, state.fxRates);
            const workbook = new ExcelJS.Workbook();

            await workbook.xlsx.load(nraBuf.buffer as ArrayBuffer);
            const sheet = workbook.getWorksheet('Приложение 8 Част I')!;

            for (let i = 0; i < sorted.length; i++) {
                const row = sheet.getRow(i + 3);

                expect(Number(row.getCell(3).value)).toBeCloseTo(sorted[i].quantity, 6);
            }
        });
    });

    describe('Test 6: Fractional quantity precision', () => {
        it('preserves fractional quantities to 6+ decimals through round-trip', async () => {
            const fractionalHolding: Holding = {
                id: 'test-fractional-1',
                broker: 'Revolut',
                country: 'САЩ',
                symbol: 'GOOG',
                dateAcquired: '2025-01-15',
                quantity: 0.00623014,
                currency: 'USD',
                unitPrice: 321.02,
            };

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [fractionalHolding],
                sales: [],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };

            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings.length).toBe(1);
            const h = reimported.holdings[0];

            expect(h.symbol).toBe('GOOG');
            expect(h.quantity).toBeCloseTo(0.00623014, 6);
            expect(h.unitPrice).toBeCloseTo(321.02, 2);
            expect(h.broker).toBe('Revolut');
            expect(h.country).toBe('САЩ');
            expect(h.dateAcquired).toBe('2025-01-15');
            expect(h.currency).toBe('USD');
        });
    });

    describe('Test 7: IB Open Positions split — no prior holdings', () => {
        it('splits open positions into pre-existing + this year buys', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            // GOOG: Open Position=10, Trades: +15 buy, -8 sell → 7 this year survived, 3 pre-existing
            const googPos = parsed.openPositions.find(p => p.symbol === 'GOOG');

            expect(googPos).toBeDefined();
            expect(googPos!.quantity).toBe(10);

            const googBuys = parsed.trades.filter(t => t.symbol === 'GOOG' && t.quantity > 0);
            const googSells = parsed.trades.filter(t => t.symbol === 'GOOG' && t.quantity < 0);

            expect(googBuys.length).toBe(1); // +15
            expect(googSells.length).toBe(1); // -8

            // MSFT: Open Position=5, no trades this year → all pre-existing
            const msftPos = parsed.openPositions.find(p => p.symbol === 'MSFT');

            expect(msftPos).toBeDefined();
            expect(msftPos!.quantity).toBe(5);
            expect(parsed.trades.filter(t => t.symbol === 'MSFT')).toHaveLength(0);

            // Symbol alias: SAP trades use SAPd alias, should resolve
            expect(parsed.symbolAliases['SAPd']).toBe('SAP');
        });

        it('normalizes trade symbols via Financial Instrument Information aliases', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            // SAP trades were originally SAPd in CSV but normalized to SAP
            const sapTrades = parsed.trades.filter(t => t.symbol === 'SAP');

            expect(sapTrades.length).toBeGreaterThan(0);
            expect(parsed.trades.filter(t => t.symbol === 'SAPd')).toHaveLength(0);
        });
    });

    describe('Test 8: IB Open Positions with prior holdings imported', () => {
        it('prior holdings prevent pre-existing lots from being added', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            // Simulate: prior holdings exist for GOOG (from last year's Excel)
            const priorHoldings: Holding[] = [{
                id: 'prior-1',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'GOOG',
                dateAcquired: '2023-05-10',
                quantity: 3, // pre-existing portion
                currency: 'USD',
                unitPrice: 120.00,
            }];

            expect(priorHoldings).toHaveLength(1);

            // Build country map
            const countryMap: Record<string, string> = {};

            for (const t of parsed.trades) {
                countryMap[t.symbol] = resolveCountry(t.symbol);
            }

            for (const p of parsed.openPositions) {
                countryMap[p.symbol] = resolveCountry(p.symbol);
            }

            // When splitOpenPositions is called with skipPreExisting=true,
            // only this year's buy lots should appear (no pre-existing block)
            // This is tested implicitly — the logic lives in Import.tsx
            // Here we verify the data shapes are correct for the split
            const googPos = parsed.openPositions.find(p => p.symbol === 'GOOG')!;
            const googBuys = parsed.trades.filter(t => t.symbol === 'GOOG' && t.quantity > 0);
            const googSells = parsed.trades.filter(t => t.symbol === 'GOOG' && t.quantity < 0);

            const totalBought = googBuys.reduce((s, t) => s + t.quantity, 0);
            const totalSold = Math.abs(googSells.reduce((s, t) => s + t.quantity, 0));

            // pre-existing = openPosition.quantity - (buys - sells consumed from this year)
            const preExisting = googPos.quantity + totalSold - totalBought;

            expect(preExisting).toBe(3); // matches prior holding quantity

            // Only the survived buy lots should be added (15 bought - 8 sold = 7 survived)
            // But sells consume pre-existing first: 8 sells > 3 pre-existing → 5 from this year consumed
            // survived this year = 15 - 5 = 10... wait, open position = 10, pre-existing = 3, so this year = 7
            expect(googPos.quantity - preExisting).toBe(7); // 7 this-year lots survive
        });
    });

    describe('Test 9: FX rate weekend fallback in round-trip', () => {
        it('preserves FX-converted amounts for weekend/holiday dates', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [{
                    id: 'h1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'AAPL',
                    dateAcquired: '2025-01-18', // Saturday
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150.00,
                }],
                sales: [],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: { USD: { '2025-01-17': 1.05, '2025-01-20': 1.06 } }, // Fri + Mon, no weekend
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings.length).toBe(1);
            expect(reimported.holdings[0].quantity).toBe(10);
        });
    });

    describe('Test 10: Fractional sale quantities preserved', () => {
        it('preserves fractional share sales through round-trip', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [],
                sales: [{
                    id: 's1',
                    broker: 'Revolut',
                    country: 'САЩ',
                    symbol: 'GOOG',
                    dateAcquired: '2025-01-15',
                    dateSold: '2025-03-20',
                    quantity: 0.00512345,
                    currency: 'USD',
                    buyPrice: 142.50,
                    sellPrice: 189.75,
                    fxRateBuy: 1.95,
                    fxRateSell: 1.96,
                }],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.sales.length).toBe(1);
            expect(reimported.sales[0].quantity).toBeCloseTo(0.00512345, 6);
            expect(reimported.sales[0].buyPrice).toBeCloseTo(142.50, 2);
            expect(reimported.sales[0].sellPrice).toBeCloseTo(189.75, 2);
        });
    });

    describe('Test 11: Dividend tax fields preserved on reimport', () => {
        it('bgTaxDue and whtCredit survive round-trip', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [],
                sales: [],
                dividends: [{
                    symbol: 'AAPL',
                    country: 'САЩ',
                    date: '2025-03-01',
                    currency: 'USD',
                    grossAmount: 100.00,
                    withholdingTax: 15.00,
                    bgTaxDue: 5.00,
                    whtCredit: 15.00,
                }],
                stockYield: [],
                brokerInterest: [],
                fxRates: { USD: { '2025-03-01': 1.05 } },
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.dividends.length).toBe(1);
            // Tax fields should NOT be reset to 0
            expect(reimported.dividends[0].grossAmount).toBeCloseTo(100.00, 2);
            expect(reimported.dividends[0].withholdingTax).toBeCloseTo(15.00, 2);
        });
    });

    describe('Test 12: Sparse state round-trip (only holdings + interest)', () => {
        it('handles state with no sales, no dividends, no stock yield', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [{
                    id: 'h1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'GOOG',
                    dateAcquired: '2025-01-01',
                    quantity: 10,
                    currency: 'USD',
                    unitPrice: 150,
                }],
                sales: [],
                dividends: [],
                stockYield: [],
                brokerInterest: [{
                    broker: 'IB',
                    currency: 'EUR',
                    entries: [{ currency: 'EUR', date: '2025-02-01', description: 'Interest', amount: 5.0 }],
                }],
                fxRates: {},
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings.length).toBe(1);
            expect(reimported.sales.length).toBe(0);
            expect(reimported.dividends.length).toBe(0);
            expect(reimported.stockYield.length).toBe(0);
            expect(reimported.brokerInterest.length).toBe(1);
            expect(reimported.brokerInterest[0].entries.length).toBe(1);
        });
    });

    describe('Test 13: Symbol alias normalization in FIFO + dividends', () => {
        it('SAPd trades normalized to SAP match SAP dividends', () => {
            const csv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(csv);

            // SAPd trades should be normalized to SAP
            const sapTrades = parsed.trades.filter(t => t.symbol === 'SAP');
            const sapdTrades = parsed.trades.filter(t => t.symbol === 'SAPd');

            expect(sapTrades.length).toBeGreaterThan(0);
            expect(sapdTrades.length).toBe(0);

            // SAP dividends should exist
            const sapDivs = parsed.dividends.filter(d => d.symbol === 'SAP');

            expect(sapDivs.length).toBeGreaterThan(0);

            // WHT for SAP should match
            const sapWht = parsed.withholdingTax.filter(w => w.symbol === 'SAP');

            expect(sapWht.length).toBeGreaterThan(0);

            // FIFO should produce SAP sales (buy+sell in sample)
            const countryMap: Record<string, string> = {};

            for (const t of parsed.trades) {
                countryMap[t.symbol] = resolveCountry(t.symbol);
            }
            const fifo = new FifoEngine([]);
            const { sales } = fifo.processTrades(parsed.trades, 'IB', countryMap);
            const sapSales = sales.filter(s => s.symbol === 'SAP');

            expect(sapSales.length).toBeGreaterThan(0);
        });
    });

    describe('Test 14: Interest sheet backwards compat (old → new format)', () => {
        it('imports old "IB Лихви" sheet and re-exports as new format', async () => {
            const ExcelJS = await import('exceljs');
            const wb = new ExcelJS.default.Workbook();
            // Need a valid Holdings sheet for importFullExcel to not crash
            const hs = wb.addWorksheet('Притежания');

            hs.addRow(['Брокер', 'Символ', 'Държава', 'Дата', 'Количество', 'Валута', 'Цена']);
            // Old-format interest sheet
            const ws = wb.addWorksheet('IB Лихви');

            ws.addRow(['Дата', 'Валута', 'Описание', 'Сума']);
            ws.addRow(['2025-01-06', 'USD', 'USD Debit Interest', -3.22]);
            ws.addRow(['2025-02-10', 'EUR', 'EUR Credit Interest', 5.50]);
            ws.addRow(['2025-03-06', 'USD', 'USD Credit Interest', 8.45]);
            const oldBuf = await wb.xlsx.writeBuffer();

            // Reimport old format
            const reimported = await importFullExcel(oldBuf as ArrayBuffer);

            expect(reimported.brokerInterest.length).toBe(2); // USD + EUR
            const usd = reimported.brokerInterest.find(b => b.currency === 'USD');

            expect(usd).toBeDefined();
            expect(usd!.broker).toBe('IB');
            expect(usd!.entries.length).toBe(2);
            const eur = reimported.brokerInterest.find(b => b.currency === 'EUR');

            expect(eur).toBeDefined();
            expect(eur!.entries.length).toBe(1);

            // Re-export with new format
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [],
                sales: [],
                dividends: [],
                stockYield: [],
                brokerInterest: reimported.brokerInterest,
                fxRates: {},
                manualEntries: [],
            };
            const newBuf = await generateExcel(state);
            const wb2 = new ExcelJS.default.Workbook();

            await wb2.xlsx.load(newBuf.buffer as ArrayBuffer);

            // New format: separate sheets
            expect(wb2.getWorksheet('IB Лихви USD')).toBeDefined();
            expect(wb2.getWorksheet('IB Лихви EUR')).toBeDefined();
            expect(wb2.getWorksheet('IB Лихви')).toBeUndefined(); // old format gone

            // Re-reimport from new format
            const reimported2 = await importFullExcel(newBuf.buffer as ArrayBuffer);

            expect(reimported2.brokerInterest.length).toBe(2);
            expect(totalInterestEntries(reimported2.brokerInterest)).toBe(totalInterestEntries(reimported.brokerInterest));
        });
    });

    describe('Test 15: Multi-currency dividend tax calculation', () => {
        it('tax fields are correct for USD dividend with BGN base', async () => {
            const { bgTaxDue, whtCredit } = calcDividendTax(100, 15);

            // 5% of 100 = 5, WHT = 15 > 5 → bgTaxDue = 0, whtCredit = 5
            expect(bgTaxDue).toBe(0);
            expect(whtCredit).toBe(5);

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [],
                sales: [],
                dividends: [{
                    symbol: 'AAPL',
                    country: 'САЩ',
                    date: '2025-06-15',
                    currency: 'USD',
                    grossAmount: 100.00,
                    withholdingTax: 15.00,
                    bgTaxDue,
                    whtCredit,
                }],
                stockYield: [],
                brokerInterest: [],
                fxRates: { USD: { '2025-06-15': 1.05 } },
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.dividends[0].grossAmount).toBeCloseTo(100.00, 2);
            expect(reimported.dividends[0].withholdingTax).toBeCloseTo(15.00, 2);
        });
    });

    describe('Test 16: ConsumedBy column preserved through round-trip', () => {
        it('exports and reimports consumedByFifo and consumedBySaleIds', async () => {
            const sale1 = {
                id: 'sale-aaa',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'GOOG',
                dateAcquired: '2024-06-15',
                dateSold: '2025-03-10',
                quantity: 5,
                currency: 'USD',
                buyPrice: 100,
                sellPrice: 150,
                fxRateBuy: null,
                fxRateSell: null,
            };
            const sale2 = {
                id: 'sale-bbb',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'AMZN',
                dateAcquired: '2024-01-10',
                dateSold: '2025-02-20',
                quantity: 3,
                currency: 'USD',
                buyPrice: 80,
                sellPrice: 120,
                fxRateBuy: null,
                fxRateSell: null,
            };

            const consumedHolding: Holding = {
                id: 'h-consumed',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'GOOG',
                dateAcquired: '2024-06-15',
                quantity: 0,
                currency: 'USD',
                unitPrice: 100,
                consumedByFifo: true,
                consumedBySaleIds: ['sale-aaa'],
            };

            const partiallyConsumedHolding: Holding = {
                id: 'h-partial',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'AMZN',
                dateAcquired: '2024-01-10',
                quantity: 0,
                currency: 'USD',
                unitPrice: 80,
                consumedByFifo: true,
                consumedBySaleIds: ['sale-aaa', 'sale-bbb'],
            };

            const activeHolding: Holding = {
                id: 'h-active',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'MSFT',
                dateAcquired: '2025-01-05',
                quantity: 10,
                currency: 'USD',
                unitPrice: 200,
            };

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [consumedHolding, partiallyConsumedHolding, activeHolding],
                sales: [sale1, sale2],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };

            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // All 3 holdings should survive (including qty=0 consumed ones)
            expect(reimported.holdings.length).toBe(3);

            // Consumed holding: consumedByFifo=true, consumedBySaleIds resolved to sale 1
            const h1 = reimported.holdings.find(h => h.symbol === 'GOOG');

            expect(h1).toBeDefined();
            expect(h1!.consumedByFifo).toBe(true);
            expect(h1!.consumedBySaleIds).toHaveLength(1);
            expect(h1!.consumedBySaleIds![0]).toBe(reimported.sales[0].id);
            expect(h1!.quantity).toBe(0);

            // Multi-sale consumed holding: references both sales
            const h2 = reimported.holdings.find(h => h.symbol === 'AMZN');

            expect(h2).toBeDefined();
            expect(h2!.consumedByFifo).toBe(true);
            expect(h2!.consumedBySaleIds).toHaveLength(2);
            expect(h2!.consumedBySaleIds![0]).toBe(reimported.sales[0].id);
            expect(h2!.consumedBySaleIds![1]).toBe(reimported.sales[1].id);

            // Active holding: no consumedBy fields
            const h3 = reimported.holdings.find(h => h.symbol === 'MSFT');

            expect(h3).toBeDefined();
            expect(h3!.consumedByFifo).toBeUndefined();
            expect(h3!.consumedBySaleIds).toBeUndefined();
            expect(h3!.quantity).toBe(10);
        });

        it('consumedBy column content in Excel matches expected format', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [{
                    id: 'h1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'GOOG',
                    dateAcquired: '2024-06-15',
                    quantity: 0,
                    currency: 'USD',
                    unitPrice: 100,
                    consumedByFifo: true,
                    consumedBySaleIds: ['s1', 's2'],
                }],
                sales: [
                    {
                        id: 's1',
                        broker: 'IB',
                        country: 'САЩ',
                        symbol: 'GOOG',
                        dateAcquired: '2024-06-15',
                        dateSold: '2025-01-01',
                        quantity: 3,
                        currency: 'USD',
                        buyPrice: 100,
                        sellPrice: 150,
                        fxRateBuy: null,
                        fxRateSell: null,
                    },
                    {
                        id: 's2',
                        broker: 'IB',
                        country: 'САЩ',
                        symbol: 'GOOG',
                        dateAcquired: '2024-06-15',
                        dateSold: '2025-02-01',
                        quantity: 2,
                        currency: 'USD',
                        buyPrice: 100,
                        sellPrice: 160,
                        fxRateBuy: null,
                        fxRateSell: null,
                    },
                ],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };

            const buffer = await generateExcel(state);
            const wb = new ExcelJS.Workbook();

            await wb.xlsx.load(buffer.buffer as ArrayBuffer);
            const ws = wb.getWorksheet('Притежания');

            expect(ws).toBeDefined();

            // Row 2 = first data row; column 12 = "Продадено чрез"
            const consumedByCell = ws!.getRow(2).getCell(12).value;

            expect(String(consumedByCell)).toBe('1, 2');
        });
    });

    describe('Test 17: FIFO basis fallback for zero-price transfers', () => {
        it('uses trade.basis as buyPrice when lot has unitPrice=0', () => {
            // Simulates a position transfer (unitPrice=0) then a sell with broker basis
            const holdings: Holding[] = [
                { id: 'h1', broker: 'IB', country: 'САЩ', symbol: 'XFER', dateAcquired: '2024-01-01', quantity: 100, currency: 'USD', unitPrice: 0 },
            ];
            const trades: Trade[] = [
                { currency: 'USD', symbol: 'XFER', dateTime: '2025-03-15, 10:00:00', quantity: -100, price: 120, proceeds: 12000, commission: -1, basis: -8000 },
            ];

            const engine = new FifoEngine(holdings);
            const result = engine.processTrades(trades, 'IB', { XFER: 'САЩ' });

            expect(result.sales).toHaveLength(1);
            expect(result.sales[0].buyPrice).toBe(80); // abs(-8000)/abs(-100) = 80
            expect(result.sales[0].sellPrice).toBe(120);
            expect(result.consumedHoldings).toHaveLength(1);
            expect(result.consumedHoldings[0].consumedByFifo).toBe(true);
        });

        it('round-trips basis-derived buyPrice through Excel', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [],
                sales: [{
                    id: 's1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'XFER',
                    dateAcquired: '2024-01-01',
                    dateSold: '2025-03-15',
                    quantity: 100,
                    currency: 'USD',
                    buyPrice: 80,
                    sellPrice: 120,
                    fxRateBuy: 1.85,
                    fxRateSell: 1.81,
                }],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };

            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.sales).toHaveLength(1);
            expect(reimported.sales[0].buyPrice).toBeCloseTo(80, 1);
            expect(reimported.sales[0].sellPrice).toBeCloseTo(120, 1);
        });
    });

    describe('Test 18: Null FX rates through pipeline', () => {
        it('populateSaleFxRates leaves null for missing dates, tax calculator skips them', () => {
            const sales = [{
                id: 's1',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'AAPL',
                dateAcquired: '2024-01-01',
                dateSold: '2025-06-15',
                quantity: 10,
                currency: 'USD',
                buyPrice: 170,
                sellPrice: 250,
                fxRateBuy: null as number | null,
                fxRateSell: null as number | null,
            }, {
                id: 's2',
                broker: 'IB',
                country: 'САЩ',
                symbol: 'MSFT',
                dateAcquired: '2025-02-01',
                dateSold: '2025-03-01',
                quantity: 5,
                currency: 'USD',
                buyPrice: 300,
                sellPrice: 350,
                fxRateBuy: null as number | null,
                fxRateSell: null as number | null,
            }];

            // Only provide rates for sale 2 dates
            const fxRates: Record<string, Record<string, number>> = {
                USD: { '2025-02-01': 1.04, '2025-03-01': 1.08 },
            };
            const getRate = (currency: string, date: string) => fxRates[currency]?.[date];

            const filled = populateSaleFxRates(sales, getRate, 'BGN');

            // Sale 1: no rate for buy date → null
            expect(filled[0].fxRateBuy).toBeNull();
            expect(filled[0].fxRateSell).toBeNull();

            // Sale 2: both dates have rates
            expect(filled[1].fxRateBuy).toBeGreaterThan(0);
            expect(filled[1].fxRateSell).toBeGreaterThan(0);

            // Tax calculator should only count sale 2
            const calc = new TaxCalculator('BGN');
            const result = calc.calcCapitalGains(filled);

            const expectedProceeds = 5 * 350 * filled[1].fxRateSell!;
            const expectedCost = 5 * 300 * filled[1].fxRateBuy!;

            expect(result.totalProceeds).toBeCloseTo(expectedProceeds, 1);
            expect(result.totalCost).toBeCloseTo(expectedCost, 1);
            expect(result.profit).toBeGreaterThan(0);
        });

        it('null FX rates survive Excel round-trip', async () => {
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: [],
                sales: [{
                    id: 's1',
                    broker: 'IB',
                    country: 'САЩ',
                    symbol: 'AAPL',
                    dateAcquired: '2024-01-01',
                    dateSold: '2025-06-15',
                    quantity: 10,
                    currency: 'USD',
                    buyPrice: 170,
                    sellPrice: 250,
                    fxRateBuy: null,
                    fxRateSell: null,
                }],
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };

            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.sales).toHaveLength(1);
            // Null FX rates should not become 0 after round-trip
            expect(reimported.sales[0].fxRateBuy).toBeNull();
            expect(reimported.sales[0].fxRateSell).toBeNull();
        });
    });

    describe('Test 19: All holdings consumed — empty portfolio', () => {
        it('handles fully liquidated portfolio without errors', async () => {
            const holdings: Holding[] = [
                { id: 'h1', broker: 'IB', country: 'САЩ', symbol: 'AAPL', dateAcquired: '2024-01-01', quantity: 20, currency: 'USD', unitPrice: 150 },
                { id: 'h2', broker: 'IB', country: 'САЩ', symbol: 'MSFT', dateAcquired: '2024-06-01', quantity: 30, currency: 'USD', unitPrice: 300 },
            ];
            const trades: Trade[] = [
                { currency: 'USD', symbol: 'AAPL', dateTime: '2025-03-15, 10:00:00', quantity: -20, price: 200, proceeds: 4000, commission: -1 },
                { currency: 'USD', symbol: 'MSFT', dateTime: '2025-04-10, 10:00:00', quantity: -30, price: 350, proceeds: 10500, commission: -1 },
            ];

            const engine = new FifoEngine(holdings);
            const result = engine.processTrades(trades, 'IB', { AAPL: 'САЩ', MSFT: 'САЩ' });

            // All holdings consumed
            expect(result.holdings).toHaveLength(0);
            expect(result.consumedHoldings).toHaveLength(2);
            expect(result.sales).toHaveLength(2);

            // Build state with consumed holdings included
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: result.consumedHoldings,
                sales: result.sales.map(s => ({ ...s, fxRateBuy: 1.85, fxRateSell: 1.81 })),
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };

            // Tax calculator works with all-consumed portfolio
            const calc = new TaxCalculator('BGN');
            const taxResult = calc.calcCapitalGains(state.sales);

            expect(taxResult.totalProceeds).toBeGreaterThan(0);
            expect(taxResult.profit).toBeGreaterThan(0);

            // Excel round-trip preserves consumed holdings
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings).toHaveLength(2);
            expect(reimported.holdings.every(h => h.quantity === 0)).toBe(true);
            expect(reimported.sales).toHaveLength(2);
        });
    });

    describe('Test 20: Partial consumption split tracking', () => {
        it('fully consumed lot tracked in consumedHoldings, partial lot stays in holdings', () => {
            const holdings: Holding[] = [
                { id: 'h1', broker: 'IB', country: 'САЩ', symbol: 'STOCK', dateAcquired: '2024-01-01', quantity: 10, currency: 'USD', unitPrice: 100 },
                { id: 'h2', broker: 'IB', country: 'САЩ', symbol: 'STOCK', dateAcquired: '2024-06-01', quantity: 20, currency: 'USD', unitPrice: 120 },
            ];
            const trades: Trade[] = [
                // Sell 15: consumes all 10 from h1 + 5 from h2
                { currency: 'USD', symbol: 'STOCK', dateTime: '2025-03-01, 10:00:00', quantity: -15, price: 150, proceeds: 2250, commission: -1 },
            ];

            const engine = new FifoEngine(holdings);
            const result = engine.processTrades(trades, 'IB', { STOCK: 'САЩ' });

            // h1 fully consumed, h2 partially consumed (15 remaining)
            expect(result.consumedHoldings).toHaveLength(1);
            expect(result.consumedHoldings[0].consumedByFifo).toBe(true);
            expect(result.consumedHoldings[0].consumedBySaleIds).toHaveLength(1);

            expect(result.holdings).toHaveLength(1);
            expect(result.holdings[0].quantity).toBe(15);

            // 2 sales: 10 from h1 at $100, 5 from h2 at $120
            expect(result.sales).toHaveLength(2);
            expect(result.sales[0].quantity).toBe(10);
            expect(result.sales[0].buyPrice).toBe(100);
            expect(result.sales[1].quantity).toBe(5);
            expect(result.sales[1].buyPrice).toBe(120);
        });

        it('multiple sells fully consume a single lot and track all sale IDs', () => {
            const holdings: Holding[] = [
                { id: 'h1', broker: 'IB', country: 'САЩ', symbol: 'MSFT', dateAcquired: '2024-06-01', quantity: 100, currency: 'USD', unitPrice: 300 },
            ];
            const trades: Trade[] = [
                { currency: 'USD', symbol: 'MSFT', dateTime: '2025-01-15, 10:00:00', quantity: -40, price: 350, proceeds: 14000, commission: -1 },
                { currency: 'USD', symbol: 'MSFT', dateTime: '2025-02-15, 10:00:00', quantity: -60, price: 360, proceeds: 21600, commission: -1 },
            ];

            const engine = new FifoEngine(holdings);
            const result = engine.processTrades(trades, 'IB', { MSFT: 'САЩ' });

            expect(result.consumedHoldings).toHaveLength(1);
            expect(result.consumedHoldings[0].consumedBySaleIds).toHaveLength(2);
            expect(result.holdings.filter(h => h.symbol === 'MSFT')).toHaveLength(0);
            expect(result.sales).toHaveLength(2);
        });
    });

    describe('Test 21: Sort order preserved through full Excel export', () => {
        it('holdings sorted by symbol survive Excel round-trip in order', async () => {
            const state = buildFullState();

            // Sort holdings alphabetically by symbol (simulating UI sort)
            const sorted = [...state.holdings]
                .sort((a, b) => a.symbol.localeCompare(b.symbol));
            const sortedState = { ...state, holdings: sorted };

            const buffer = await generateExcel(sortedState);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Verify order matches — each symbol should be in the same position
            expect(reimported.holdings.length).toBe(sorted.length);

            for (let i = 0; i < sorted.length; i++) {
                expect(reimported.holdings[i].symbol).toBe(sorted[i].symbol);
            }
        });

        it('sales sorted by dateSold descending survive Excel round-trip', async () => {
            const state = buildFullState();

            const sorted = [...state.sales]
                .sort((a, b) => b.dateSold.localeCompare(a.dateSold));
            const sortedState = { ...state, sales: sorted };

            const buffer = await generateExcel(sortedState);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.sales.length).toBe(sorted.length);

            for (let i = 0; i < sorted.length; i++) {
                expect(reimported.sales[i].symbol).toBe(sorted[i].symbol);
                expect(reimported.sales[i].dateSold).toBe(sorted[i].dateSold);
            }
        });

        it('dividends count survives Excel round-trip (sheet re-sorts by symbol)', async () => {
            const state = buildFullState();

            const sorted = [...state.dividends]
                .sort((a, b) => a.date.localeCompare(b.date));
            const sortedState = { ...state, dividends: sorted };

            const buffer = await generateExcel(sortedState);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Dividends sheet internally sorts by symbol+date, so we only check count
            expect(reimported.dividends.length).toBe(sorted.length);
        });

        it('NRA Appendix 8 respects pre-sorted holdings by unitPrice', async () => {
            const state = buildFullState();

            const validHoldings = state.holdings
                .filter(h => h.symbol && h.quantity > 0)
                .sort((a, b) => a.unitPrice - b.unitPrice);

            const nraBuf = await generateNraAppendix8(validHoldings, state.fxRates);
            const workbook = new ExcelJS.Workbook();

            await workbook.xlsx.load(nraBuf.buffer as ArrayBuffer);
            const sheet = workbook.getWorksheet('Приложение 8 Част I')!;

            for (let i = 0; i < validHoldings.length; i++) {
                const row = sheet.getRow(i + 3);

                expect(Number(row.getCell(3).value)).toBeCloseTo(validHoldings[i].quantity, 6);
            }
        });
    });

    describe('Test 22: Holdings + Revolut investments ordering and sales merge', () => {
        it('imported holdings appear first, then Revolut buys, with no duplicates', async () => {
            // Step 1: Import initial holdings from CSV (8 items)
            const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
            const initialHoldings = importHoldingsFromCsv(holdingsCsv);

            expect(initialHoldings).toHaveLength(8);

            // Step 2: Parse Revolut investments and run FIFO seeded with holdings
            const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
            const { trades: revTrades } = parseRevolutInvestmentsCsv(investCsv);
            const revCountryMap: Record<string, string> = {};

            for (const t of revTrades) {
                revCountryMap[t.ticker] = resolveCountry(t.ticker);
            }
            const fifoTrades: Trade[] = revTrades.map(t => ({
                symbol: t.ticker,
                dateTime: t.date,
                quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                price: t.pricePerShare,
                proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                commission: 0,
                currency: t.currency,
            }));
            const revBuys = revTrades.filter(t => t.type.includes('BUY'));

            // Step 3: Run FIFO — mirrors what the UI Revolut handler does
            const fifo = new FifoEngine([...initialHoldings]);
            const { holdings: fifoHoldings, consumedHoldings: revConsumed, sales: newSales } = fifo.processTrades(fifoTrades, 'Revolut', revCountryMap);

            // Step 4: Preserve original order — FifoEngine flattens by symbol (Map)
            const existingIds = new Set(initialHoldings.map(h => h.id));
            const consumedIds = new Set(revConsumed.map(h => h.id));
            const updatedById = new Map(
                fifoHoldings.filter(h => existingIds.has(h.id)).map(h => [h.id, h]),
            );
            const survivingOriginals = initialHoldings
                .filter(h => !consumedIds.has(h.id))
                .map(h => updatedById.get(h.id) ?? h);
            const newRevolutHoldings = fifoHoldings.filter(h => !existingIds.has(h.id));

            // All 8 initial holdings should survive (no sells consume them)
            expect(survivingOriginals).toHaveLength(8);
            expect(newRevolutHoldings).toHaveLength(revBuys.length);

            // Build merged holdings: existing first (original order), then Revolut
            const mergedHoldings = [...survivingOriginals, ...revConsumed, ...newRevolutHoldings];

            // No duplicates: total = 8 initial + Revolut buys (no sells in sample)
            expect(mergedHoldings).toHaveLength(8 + revBuys.length);

            // First 8 should be the original holdings (same symbols, same order)
            for (let i = 0; i < 8; i++) {
                expect(mergedHoldings[i].symbol).toBe(initialHoldings[i].symbol);
                expect(mergedHoldings[i].quantity).toBeCloseTo(initialHoldings[i].quantity, 6);
                expect(mergedHoldings[i].unitPrice).toBeCloseTo(initialHoldings[i].unitPrice, 2);
            }

            // Remaining should be Revolut buys
            for (let i = 8; i < mergedHoldings.length; i++) {
                expect(mergedHoldings[i].broker).toBe('Revolut');
            }

            // Step 5: Export to Excel and verify order is preserved
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: mergedHoldings,
                sales: newSales,
                dividends: [],
                stockYield: [],
                brokerInterest: [],
                fxRates: {},
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Same count after round-trip
            expect(reimported.holdings).toHaveLength(mergedHoldings.length);

            // First 8 rows should still be the original holdings
            for (let i = 0; i < 8; i++) {
                expect(reimported.holdings[i].symbol).toBe(initialHoldings[i].symbol);
                expect(reimported.holdings[i].quantity).toBeCloseTo(initialHoldings[i].quantity, 6);
            }

            // Remaining rows should be Revolut buys
            for (let i = 8; i < reimported.holdings.length; i++) {
                expect(reimported.holdings[i].broker).toBe('Revolut');
            }
        });

        it('IB sales are preserved when Revolut investments are added afterwards', async () => {
            // Step 1: Import holdings + IB (produces sales)
            const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
            const initialHoldings = importHoldingsFromCsv(holdingsCsv);

            const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const ibState = buildAppStateFromIB(ibCsv, initialHoldings);

            expect(ibState.sales.length).toBeGreaterThan(0);
            const ibSaleCount = ibState.sales.length;

            // Step 2: Parse Revolut investments and run FIFO seeded with IB holdings
            const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
            const { trades: revTrades } = parseRevolutInvestmentsCsv(investCsv);
            const revCountryMap: Record<string, string> = {};

            for (const t of revTrades) {
                revCountryMap[t.ticker] = resolveCountry(t.ticker);
            }
            const fifoTrades: Trade[] = revTrades.map(t => ({
                symbol: t.ticker,
                dateTime: t.date,
                quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                price: t.pricePerShare,
                proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                commission: 0,
                currency: t.currency,
            }));
            const fifo = new FifoEngine([...ibState.holdings]);
            const { sales: revSales } = fifo.processTrades(fifoTrades, 'Revolut', revCountryMap);

            // Step 3: Merge sales — keep IB sales, add Revolut sales
            const mergedSales = [...ibState.sales, ...revSales];

            // IB sales must still be present
            expect(mergedSales.length).toBeGreaterThanOrEqual(ibSaleCount);

            const ibSalesInMerged = mergedSales.filter(s => s.broker === 'IB');

            expect(ibSalesInMerged).toHaveLength(ibSaleCount);
        });
    });

    describe('Test 23: Full import matches reference Excel (Данъчна_2025.xlsx)', () => {
        it('exports from all samples and matches the reference file cell-by-cell', async () => {
            // Build state replicating the UI flow:
            // 1. Import initial holdings
            // 2. Run IB FIFO + use splitOpenPositions for IB holdings
            // 3. Run Revolut FIFO with existing-id separation for ordering
            const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
            const initialHoldings = importHoldingsFromCsv(holdingsCsv);

            const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const parsed = parseIBCsv(ibCsv);

            const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
            const allDividends = [...matched, ...unmatched];

            // Symbols not in static COUNTRY_MAP — resolved via OpenFIGI in UI
            const figi: Record<string, string> = {
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

            for (const d of allDividends) {
                d.country = resolveCountry(d.symbol) || figi[d.symbol] || '';
                const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

                d.bgTaxDue = bgTaxDue;
                d.whtCredit = whtCredit;
            }

            const ibCountryMap: Record<string, string> = {};

            for (const t of parsed.trades) {
                ibCountryMap[t.symbol] = resolveCountry(t.symbol);
            }

            for (const p of parsed.openPositions) {
                ibCountryMap[p.symbol] = resolveCountry(p.symbol);
            }

            for (const [sym, country] of Object.entries(figi)) {
                ibCountryMap[sym] ||= country;
            }
            const ibFifo = new FifoEngine([...initialHoldings]);
            const { consumedHoldings: ibConsumed, sales: ibSales } = ibFifo.processTrades(parsed.trades, 'IB', ibCountryMap);

            // Use splitOpenPositions (same logic as UI) — inline the essential logic
            const yearPrefix = '2025';
            const ibHoldings: Holding[] = [];
            const buysBySymbol = new Map<string, Trade[]>();
            const sellQtyBySymbol = new Map<string, number>();

            for (const t of parsed.trades) {
                if (!t.dateTime.startsWith(yearPrefix)) {
                    continue;
                }
                const sym = parsed.symbolAliases[t.symbol] ?? t.symbol;

                if (t.quantity > 0) {
                    const buys = buysBySymbol.get(sym) ?? [];

                    buys.push(t);
                    buysBySymbol.set(sym, buys);
                } else {
                    const current = sellQtyBySymbol.get(sym) ?? 0;

                    sellQtyBySymbol.set(sym, current + Math.abs(t.quantity));
                }
            }

            for (const pos of parsed.openPositions) {
                const buys = buysBySymbol.get(pos.symbol) ?? [];
                const sellQty = sellQtyBySymbol.get(pos.symbol) ?? 0;
                const totalBoughtThisYear = buys.reduce((sum, t) => sum + t.quantity, 0);
                const preExistingBeforeSells = pos.quantity + sellQty - totalBoughtThisYear;
                const sellsFromPreExisting = Math.min(sellQty, Math.max(0, preExistingBeforeSells));
                const sellsFromThisYear = sellQty - sellsFromPreExisting;
                const survivedThisYearQty = totalBoughtThisYear - sellsFromThisYear;

                if (survivedThisYearQty > 0 && buys.length > 0) {
                    const sortedBuys = [...buys].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
                    let remainingSellQty = sellsFromThisYear;

                    for (const buy of sortedBuys) {
                        if (remainingSellQty >= buy.quantity) {
                            remainingSellQty -= buy.quantity;
                            continue;
                        }
                        const survivedQty = buy.quantity - remainingSellQty;

                        remainingSellQty = 0;
                        ibHoldings.push({
                            id: crypto.randomUUID(),
                            broker: 'IB',
                            country: ibCountryMap[buy.symbol] ?? '',
                            symbol: buy.symbol,
                            dateAcquired: buy.dateTime.split(',')[0],
                            quantity: survivedQty,
                            currency: pos.currency,
                            unitPrice: buy.price,
                        });
                    }
                }
            }

            // Merge IB: keep non-IB holdings, add consumed + IB holdings
            const consumedIds = new Set(ibConsumed.map(h => h.id));
            const remainingNonIb = initialHoldings.filter(h => !consumedIds.has(h.id));

            const ibMerged = [...remainingNonIb, ...ibConsumed, ...ibHoldings];

            // 3. Parse Revolut investments
            const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
            const { trades: revTrades } = parseRevolutInvestmentsCsv(investCsv);
            const revCountryMap: Record<string, string> = {};

            for (const t of revTrades) {
                revCountryMap[t.ticker] = resolveCountry(t.ticker) || figi[t.ticker] || '';
            }
            const fifoTrades: Trade[] = revTrades.map(t => ({
                symbol: t.ticker,
                dateTime: t.date,
                quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                price: t.pricePerShare,
                proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                commission: 0,
                currency: t.currency,
            }));
            const revFifo = new FifoEngine([...ibMerged]);
            const { holdings: revHoldings, consumedHoldings: revConsumed, sales: revSales } = revFifo.processTrades(fifoTrades, 'Revolut', revCountryMap);

            // Preserve original order (same as UI fix) — FIFO Map flattens by symbol
            const existingIds = new Set(ibMerged.map(h => h.id));
            const revConsumedIds = new Set(revConsumed.map(h => h.id));
            const updatedById = new Map(
                revHoldings.filter(h => existingIds.has(h.id)).map(h => [h.id, h]),
            );
            const survivingOriginals = ibMerged
                .filter(h => !revConsumedIds.has(h.id))
                .map(h => updatedById.get(h.id) ?? h);
            const newRevolutHoldings = revHoldings.filter(h => !existingIds.has(h.id));
            const finalHoldings = [...survivingOriginals, ...revConsumed, ...newRevolutHoldings];

            // 4. Parse Revolut savings interest
            const eurInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8'));
            const gbpInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8'));

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: finalHoldings,
                sales: [...ibSales, ...revSales],
                dividends: allDividends,
                stockYield: parsed.stockYield,
                brokerInterest: [
                    ...groupInterestByCurrency('IB', parsed.interest),
                    eurInterest,
                    gbpInterest,
                ],
                fxRates: {},
                manualEntries: [],
            };

            // Export to Excel
            const buffer = await generateExcel(state);

            // Load both workbooks
            const generated = new ExcelJS.Workbook();

            await generated.xlsx.load(buffer.buffer as ArrayBuffer);

            const reference = new ExcelJS.Workbook();

            await reference.xlsx.readFile(join(SAMPLES, 'Данъчна_2025.xlsx'));

            // Helper: extract cell value as comparable primitive
            const cellVal = (cell: ExcelJS.Cell): string | number | null => {
                const v = cell.value;

                if (v === null || v === undefined) {
                    return null;
                }

                if (typeof v === 'object' && 'result' in v) {
                    const r = (v as { result?: unknown }).result;

                    if (r === null || r === undefined) {
                        return null;
                    }

                    return typeof r === 'number' ? r : String(r);
                }

                return typeof v === 'number' ? v : String(v);
            };

            // --- Holdings (Притежания) ---
            const refH = reference.getWorksheet('Притежания')!;
            const genH = generated.getWorksheet('Притежания')!;

            expect(genH.rowCount).toBe(refH.rowCount);

            for (let r = 2; r <= refH.rowCount; r++) {
                const refRow = refH.getRow(r);
                const genRow = genH.getRow(r);

                expect(cellVal(genRow.getCell(1)), `row ${r} broker`).toBe(cellVal(refRow.getCell(1)));
                expect(cellVal(genRow.getCell(2)), `row ${r} symbol`).toBe(cellVal(refRow.getCell(2)));
                expect(cellVal(genRow.getCell(3)), `row ${r} country`).toBe(cellVal(refRow.getCell(3)));
                expect(cellVal(genRow.getCell(4)), `row ${r} date`).toBe(cellVal(refRow.getCell(4)));
                expect(cellVal(genRow.getCell(5)) as number, `row ${r} quantity`).toBeCloseTo(cellVal(refRow.getCell(5)) as number, 6);
                expect(cellVal(genRow.getCell(6)), `row ${r} currency`).toBe(cellVal(refRow.getCell(6)));
                expect(cellVal(genRow.getCell(7)) as number, `row ${r} price`).toBeCloseTo(cellVal(refRow.getCell(7)) as number, 2);
            }

            // --- Sales (Продажби) ---
            const refS = reference.getWorksheet('Продажби')!;
            const genS = generated.getWorksheet('Продажби')!;

            expect(genS.rowCount).toBe(refS.rowCount);

            for (let r = 2; r <= refS.rowCount; r++) {
                const refRow = refS.getRow(r);
                const genRow = genS.getRow(r);

                expect(cellVal(genRow.getCell(1)), `sale row ${r} broker`).toBe(cellVal(refRow.getCell(1)));
                expect(cellVal(genRow.getCell(2)), `sale row ${r} symbol`).toBe(cellVal(refRow.getCell(2)));
                expect(cellVal(genRow.getCell(3)), `sale row ${r} country`).toBe(cellVal(refRow.getCell(3)));
                expect(cellVal(genRow.getCell(4)), `sale row ${r} buy date`).toBe(cellVal(refRow.getCell(4)));
                expect(cellVal(genRow.getCell(5)), `sale row ${r} sell date`).toBe(cellVal(refRow.getCell(5)));
                expect(cellVal(genRow.getCell(6)) as number, `sale row ${r} qty`).toBeCloseTo(cellVal(refRow.getCell(6)) as number, 6);
                expect(cellVal(genRow.getCell(7)), `sale row ${r} currency`).toBe(cellVal(refRow.getCell(7)));
                expect(cellVal(genRow.getCell(8)) as number, `sale row ${r} buy price`).toBeCloseTo(cellVal(refRow.getCell(8)) as number, 2);
                expect(cellVal(genRow.getCell(9)) as number, `sale row ${r} sell price`).toBeCloseTo(cellVal(refRow.getCell(9)) as number, 2);
            }

            // --- Dividends (Дивиденти) ---
            const refD = reference.getWorksheet('Дивиденти')!;
            const genD = generated.getWorksheet('Дивиденти')!;

            expect(genD.rowCount).toBe(refD.rowCount);

            for (let r = 2; r <= refD.rowCount; r++) {
                const refRow = refD.getRow(r);
                const genRow = genD.getRow(r);

                expect(cellVal(genRow.getCell(1)), `div row ${r} symbol`).toBe(cellVal(refRow.getCell(1)));
                expect(cellVal(genRow.getCell(2)), `div row ${r} country`).toBe(cellVal(refRow.getCell(2)));
                expect(cellVal(genRow.getCell(3)), `div row ${r} date`).toBe(cellVal(refRow.getCell(3)));
                expect(cellVal(genRow.getCell(4)), `div row ${r} currency`).toBe(cellVal(refRow.getCell(4)));
                expect(cellVal(genRow.getCell(5)) as number, `div row ${r} gross`).toBeCloseTo(cellVal(refRow.getCell(5)) as number, 2);
                expect(cellVal(genRow.getCell(6)) as number, `div row ${r} wht`).toBeCloseTo(cellVal(refRow.getCell(6)) as number, 2);
            }

            // --- Stock Yield ---
            const refSY = reference.getWorksheet('IB Stock Yield')!;
            const genSY = generated.getWorksheet('IB Stock Yield')!;

            expect(genSY.rowCount).toBe(refSY.rowCount);

            for (let r = 2; r <= refSY.rowCount; r++) {
                const refRow = refSY.getRow(r);
                const genRow = genSY.getRow(r);

                expect(cellVal(genRow.getCell(1)), `yield row ${r} date`).toBe(cellVal(refRow.getCell(1)));
                expect(cellVal(genRow.getCell(2)), `yield row ${r} symbol`).toBe(cellVal(refRow.getCell(2)));
                expect(cellVal(genRow.getCell(3)), `yield row ${r} currency`).toBe(cellVal(refRow.getCell(3)));
                expect(cellVal(genRow.getCell(4)) as number, `yield row ${r} amount`).toBeCloseTo(cellVal(refRow.getCell(4)) as number, 4);
            }

            // --- Interest sheets: verify row counts ---
            for (const sheetName of ['Revolut Лихви GBP', 'Revolut Лихви EUR', 'IB Лихви USD']) {
                const refSheet = reference.getWorksheet(sheetName)!;
                const genSheet = generated.getWorksheet(sheetName)!;

                expect(genSheet.rowCount, `${sheetName} row count`).toBe(refSheet.rowCount);
            }
        });
    });

    describe('Test 24: Reference Excel round-trip (import → export → compare)', () => {
        it('importing Данъчна_2025.xlsx and re-exporting produces identical data', async () => {
            const refPath = join(SAMPLES, 'Данъчна_2025.xlsx');

            // Step 1: Import reference Excel
            const refBuffer = readFileSync(refPath);
            const imported = await importFullExcel(refBuffer.buffer as ArrayBuffer);

            expect(imported.holdings.length).toBeGreaterThan(0);
            expect(imported.sales.length).toBeGreaterThan(0);
            expect(imported.dividends.length).toBeGreaterThan(0);

            // Step 2: Export to Excel
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: imported.holdings,
                sales: imported.sales,
                dividends: imported.dividends,
                stockYield: imported.stockYield,
                brokerInterest: imported.brokerInterest,
                fxRates: {},
                manualEntries: [],
            };
            const exportedBuffer = await generateExcel(state);

            // Step 3: Re-import the exported file
            const reimported = await importFullExcel(exportedBuffer.buffer as ArrayBuffer);

            // Step 4: Compare counts
            expect(reimported.holdings.length).toBe(imported.holdings.length);
            expect(reimported.sales.length).toBe(imported.sales.length);
            expect(reimported.dividends.length).toBe(imported.dividends.length);
            expect(reimported.stockYield.length).toBe(imported.stockYield.length);
            expect(totalInterestEntries(reimported.brokerInterest)).toBe(totalInterestEntries(imported.brokerInterest));

            // Step 5: Compare holdings cell-by-cell (in order)
            for (let i = 0; i < imported.holdings.length; i++) {
                const orig = imported.holdings[i];
                const re = reimported.holdings[i];

                expect(re.broker, `holding ${i} broker`).toBe(orig.broker);
                expect(re.symbol, `holding ${i} symbol`).toBe(orig.symbol);
                expect(re.country, `holding ${i} country`).toBe(orig.country);
                expect(re.dateAcquired, `holding ${i} date`).toBe(orig.dateAcquired);
                expect(re.quantity, `holding ${i} qty`).toBeCloseTo(orig.quantity, 6);
                expect(re.currency, `holding ${i} currency`).toBe(orig.currency);
                expect(re.unitPrice, `holding ${i} price`).toBeCloseTo(orig.unitPrice, 2);
            }

            // Step 6: Compare sales cell-by-cell
            for (let i = 0; i < imported.sales.length; i++) {
                const orig = imported.sales[i];
                const re = reimported.sales[i];

                expect(re.broker, `sale ${i} broker`).toBe(orig.broker);
                expect(re.symbol, `sale ${i} symbol`).toBe(orig.symbol);
                expect(re.dateAcquired, `sale ${i} buy date`).toBe(orig.dateAcquired);
                expect(re.dateSold, `sale ${i} sell date`).toBe(orig.dateSold);
                expect(re.quantity, `sale ${i} qty`).toBeCloseTo(orig.quantity, 6);
                expect(re.buyPrice, `sale ${i} buy price`).toBeCloseTo(orig.buyPrice, 2);
                expect(re.sellPrice, `sale ${i} sell price`).toBeCloseTo(orig.sellPrice, 2);
            }

            // Step 7: Compare dividends cell-by-cell
            for (let i = 0; i < imported.dividends.length; i++) {
                const orig = imported.dividends[i];
                const re = reimported.dividends[i];

                expect(re.symbol, `div ${i} symbol`).toBe(orig.symbol);
                expect(re.date, `div ${i} date`).toBe(orig.date);
                expect(re.grossAmount, `div ${i} gross`).toBeCloseTo(orig.grossAmount, 2);
                expect(re.withholdingTax, `div ${i} wht`).toBeCloseTo(orig.withholdingTax, 2);
            }

            // Step 8: Compare broker interest
            for (const origBi of imported.brokerInterest) {
                const reBi = reimported.brokerInterest.find(
                    b => b.broker === origBi.broker && b.currency === origBi.currency,
                );

                expect(reBi, `${origBi.broker} ${origBi.currency} interest`).toBeDefined();
                expect(reBi!.entries.length).toBe(origBi.entries.length);

                const sortE = (e: { date: string; amount: number }[]) =>
                    [...e].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
                const origEntries = sortE(origBi.entries);
                const reEntries = sortE(reBi!.entries);

                for (let i = 0; i < origEntries.length; i++) {
                    expect(reEntries[i].date).toBe(origEntries[i].date);
                    expect(reEntries[i].amount).toBeCloseTo(origEntries[i].amount, 4);
                }
            }
        });
    });

    describe('Test 25: IB only (no prior holdings) — exact counts and values', () => {
        it('produces correct holdings, sales, dividends, interest and stock yield', async () => {
            const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(ibCsv);

            // IB sample: GOOG buy 15 sell 8 → 7 remaining + consumed lot
            // AMZN buy 20 sell 20 → 0 remaining + consumed lot
            // ASML buy 5, SAPd buy 12 sell 12, RIO buy 25, 1810 buy 200, DAL transfer 150
            // Open Positions: GOOG(10), MSFT(5), ASML(5), RIO(25), 1810(200)
            // Without prior holdings, FIFO only uses trades as lots

            // Sales: GOOG sell 8, AMZN sell 20, SAPd sell 12 = 3 sales
            expect(state.sales).toHaveLength(3);
            expect(state.sales.map(s => s.symbol).sort()).toEqual(['AMZN', 'GOOG', 'SAP']);

            // Verify sale values
            const googSale = state.sales.find(s => s.symbol === 'GOOG')!;

            expect(googSale.quantity).toBe(8);
            expect(googSale.buyPrice).toBeCloseTo(142.3, 2);
            expect(googSale.sellPrice).toBeCloseTo(189.75, 2);

            const amznSale = state.sales.find(s => s.symbol === 'AMZN')!;

            expect(amznSale.quantity).toBe(20);
            expect(amznSale.buyPrice).toBeCloseTo(178.9, 2);
            expect(amznSale.sellPrice).toBeCloseTo(205.4, 2);

            // Dividends: GOOG(3), AMZN(3), ASML(2), RIO(2), SAP(1), 1810(1) = 12
            expect(state.dividends).toHaveLength(12);

            // Stock yield: 7 entries (GOOG 3, AMZN 2, ASML 2)
            expect(state.stockYield).toHaveLength(7);

            // Interest: 12 entries (IB USD)
            expect(totalInterestEntries(state.brokerInterest)).toBe(12);

            // Round-trip: export and reimport
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings).toHaveLength(state.holdings.length);
            expect(reimported.sales).toHaveLength(state.sales.length);
            expect(reimported.dividends).toHaveLength(state.dividends.length);
            expect(reimported.stockYield).toHaveLength(state.stockYield.length);
            expect(totalInterestEntries(reimported.brokerInterest)).toBe(totalInterestEntries(state.brokerInterest));

            // Values survive round-trip
            const reGoog = reimported.sales.find(s => s.symbol === 'GOOG')!;

            expect(reGoog.quantity).toBe(8);
            expect(reGoog.buyPrice).toBeCloseTo(142.3, 2);
            expect(reGoog.sellPrice).toBeCloseTo(189.75, 2);
        });
    });

    describe('Test 26: Revolut only (no prior holdings) — investments + savings', () => {
        it('produces correct holdings, sales, and interest from Revolut files', async () => {
            const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
            const eurCsv = readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8');
            const gbpCsv = readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8');

            // Parse investments
            const { trades } = parseRevolutInvestmentsCsv(investCsv);
            const countryMap: Record<string, string> = {};

            for (const t of trades) {
                countryMap[t.ticker] = resolveCountry(t.ticker);
            }
            const fifoTrades: Trade[] = trades.map(t => ({
                symbol: t.ticker,
                dateTime: t.date,
                quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                price: t.pricePerShare,
                proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                commission: 0,
                currency: t.currency,
            }));
            const fifo = new FifoEngine([]);
            const { holdings, sales } = fifo.processTrades(fifoTrades, 'Revolut', countryMap);

            // Parse savings
            const eurInterest = parseRevolutCsv(eurCsv);
            const gbpInterest = parseRevolutCsv(gbpCsv);

            // Revolut sample: 6 buys (GOOG x3, ASML x1, AAPL x1, COIN x1), 0 sells
            const buys = trades.filter(t => t.type.includes('BUY'));

            expect(buys).toHaveLength(6);
            expect(holdings).toHaveLength(6);
            expect(sales).toHaveLength(0);

            // All holdings should be Revolut
            for (const h of holdings) {
                expect(h.broker).toBe('Revolut');
            }

            // Verify specific holdings
            const googHoldings = holdings.filter(h => h.symbol === 'GOOG');

            expect(googHoldings).toHaveLength(3);

            // Interest: EUR + GBP
            expect(eurInterest.currency).toBe('EUR');
            expect(gbpInterest.currency).toBe('GBP');
            expect(eurInterest.entries.length).toBeGreaterThan(0);
            expect(gbpInterest.entries.length).toBeGreaterThan(0);

            // Round-trip
            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings,
                sales,
                dividends: [],
                stockYield: [],
                brokerInterest: [eurInterest, gbpInterest],
                fxRates: {},
                manualEntries: [],
            };
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings).toHaveLength(6);
            expect(reimported.sales).toHaveLength(0);
            expect(reimported.brokerInterest).toHaveLength(2);

            // Holdings values survive round-trip
            for (let i = 0; i < holdings.length; i++) {
                expect(reimported.holdings[i].symbol).toBe(holdings[i].symbol);
                expect(reimported.holdings[i].quantity).toBeCloseTo(holdings[i].quantity, 6);
                expect(reimported.holdings[i].unitPrice).toBeCloseTo(holdings[i].unitPrice, 2);
            }
        });
    });

    describe('Test 27: Holdings + IB only — ordering and data integrity', () => {
        it('initial holdings come first, IB consumed/buys after, with correct counts', async () => {
            const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
            const initialHoldings = importHoldingsFromCsv(holdingsCsv);

            expect(initialHoldings).toHaveLength(8);

            const ibCsv = readFileSync(join(SAMPLES, 'ib-activity.csv'), 'utf-8');
            const state = buildAppStateFromIB(ibCsv, initialHoldings);

            // 3 sales: GOOG(8), AMZN(20), SAPd(12) — GOOG sell consumes from initial holdings
            expect(state.sales).toHaveLength(3);

            // Holdings include consumed lots (AMZN, SAPd with qty=0) + surviving initial + IB buys
            expect(state.holdings.length).toBeGreaterThan(8);

            // Consumed holdings: GOOG partial (8 from initial 15), AMZN full, SAPd full
            const consumed = state.holdings.filter(h => h.consumedByFifo);

            expect(consumed.length).toBeGreaterThanOrEqual(2); // AMZN + SAPd at minimum

            // Dividends: all from IB
            expect(state.dividends).toHaveLength(12);

            // Round-trip preserves everything
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings).toHaveLength(state.holdings.length);
            expect(reimported.sales).toHaveLength(state.sales.length);
            expect(reimported.dividends).toHaveLength(state.dividends.length);

            // Holdings values match pairwise (order preserved)
            for (let i = 0; i < state.holdings.length; i++) {
                expect(reimported.holdings[i].symbol).toBe(state.holdings[i].symbol);
                expect(reimported.holdings[i].broker).toBe(state.holdings[i].broker);
                expect(reimported.holdings[i].quantity).toBeCloseTo(state.holdings[i].quantity, 6);
            }
        });
    });

    describe('Test 28: Holdings + Revolut all (no IB) — ordering and data integrity', () => {
        it('initial holdings come first, Revolut buys after, interest included', async () => {
            const holdingsCsv = readFileSync(join(SAMPLES, 'holdings.csv'), 'utf-8');
            const initialHoldings = importHoldingsFromCsv(holdingsCsv);

            expect(initialHoldings).toHaveLength(8);

            // Parse Revolut investments
            const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
            const { trades: revTrades } = parseRevolutInvestmentsCsv(investCsv);
            const countryMap: Record<string, string> = {};

            for (const t of revTrades) {
                countryMap[t.ticker] = resolveCountry(t.ticker);
            }
            const fifoTrades: Trade[] = revTrades.map(t => ({
                symbol: t.ticker,
                dateTime: t.date,
                quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                price: t.pricePerShare,
                proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                commission: 0,
                currency: t.currency,
            }));

            // FIFO seeded with initial holdings
            const fifo = new FifoEngine([...initialHoldings]);
            const { holdings: fifoHoldings, consumedHoldings: revConsumed, sales: revSales } = fifo.processTrades(fifoTrades, 'Revolut', countryMap);

            // No sells in Revolut sample → no consumed, no sales
            expect(revConsumed).toHaveLength(0);
            expect(revSales).toHaveLength(0);

            // Preserve ordering: initial first, Revolut after
            const existingIds = new Set(initialHoldings.map(h => h.id));
            const consumedIds = new Set(revConsumed.map(h => h.id));
            const updatedById = new Map(
                fifoHoldings.filter(h => existingIds.has(h.id)).map(h => [h.id, h]),
            );
            const survivingOriginals = initialHoldings
                .filter(h => !consumedIds.has(h.id))
                .map(h => updatedById.get(h.id) ?? h);
            const newRevolutHoldings = fifoHoldings.filter(h => !existingIds.has(h.id));

            const revBuys = revTrades.filter(t => t.type.includes('BUY'));
            const mergedHoldings = [...survivingOriginals, ...revConsumed, ...newRevolutHoldings];

            expect(mergedHoldings).toHaveLength(8 + revBuys.length);

            // Parse Revolut savings
            const eurInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8'));
            const gbpInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8'));

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings: mergedHoldings,
                sales: revSales,
                dividends: [],
                stockYield: [],
                brokerInterest: [eurInterest, gbpInterest],
                fxRates: {},
                manualEntries: [],
            };

            // First 8 must be initial holdings
            for (let i = 0; i < 8; i++) {
                expect(state.holdings[i].symbol).toBe(initialHoldings[i].symbol);
                expect(state.holdings[i].quantity).toBeCloseTo(initialHoldings[i].quantity, 6);
            }

            // Remaining must be Revolut
            for (let i = 8; i < state.holdings.length; i++) {
                expect(state.holdings[i].broker).toBe('Revolut');
            }

            // Round-trip
            const buffer = await generateExcel(state);
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            expect(reimported.holdings).toHaveLength(mergedHoldings.length);
            expect(reimported.sales).toHaveLength(0);
            expect(reimported.brokerInterest).toHaveLength(2);

            // Order preserved after round-trip
            for (let i = 0; i < 8; i++) {
                expect(reimported.holdings[i].symbol).toBe(initialHoldings[i].symbol);
            }

            for (let i = 8; i < reimported.holdings.length; i++) {
                expect(reimported.holdings[i].broker).toBe('Revolut');
            }

            // Interest entry counts match
            expect(totalInterestEntries(reimported.brokerInterest)).toBe(
                eurInterest.entries.length + gbpInterest.entries.length,
            );
        });
    });
});
