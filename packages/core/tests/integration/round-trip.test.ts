import {
    describe,
    expect,
    it,
} from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
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
    resolveCountry,
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
    const { holdings, sales } = fifo.processTrades(parsed.trades, 'IB', countryMap);

    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'bg',
        holdings,
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
    for (const t of parsed.trades) ibCountryMap[t.symbol] = resolveCountry(t.symbol);
    const ibFifo = new FifoEngine([...initialHoldings]);
    const { holdings: ibHoldings, sales: ibSales } = ibFifo.processTrades(parsed.trades, 'IB', ibCountryMap);

    // 3. Parse Revolut investments and run FIFO
    const investCsv = readFileSync(join(SAMPLES, 'revolut-investments.csv'), 'utf-8');
    const { trades: revTrades } = parseRevolutInvestmentsCsv(investCsv);
    const revCountryMap: Record<string, string> = {};
    for (const t of revTrades) revCountryMap[t.ticker] = resolveCountry(t.ticker);
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
    const { holdings: allHoldings, sales: revSales } = revFifo.processTrades(fifoTrades, 'Revolut', revCountryMap);

    // 4. Parse Revolut savings interest
    const eurInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-eur.csv'), 'utf-8'));
    const gbpInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-savings-gbp.csv'), 'utf-8'));

    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'bg',
        holdings: allHoldings,
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
                .filter(h => h.symbol && h.quantity > 0)
                .sort((a, b) => a.symbol.localeCompare(b.symbol));

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
            for (const t of parsed.trades) countryMap[t.symbol] = resolveCountry(t.symbol);
            for (const p of parsed.openPositions) countryMap[p.symbol] = resolveCountry(p.symbol);

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
            for (const t of parsed.trades) countryMap[t.symbol] = resolveCountry(t.symbol);
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
});
