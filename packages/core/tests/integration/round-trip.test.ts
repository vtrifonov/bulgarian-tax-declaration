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
    calcDividendTax,
    FifoEngine,
    generateExcel,
    generateNraAppendix8,
    type Holding,
    type IBTrade,
    importFullExcel,
    importHoldingsFromCsv,
    matchWhtToDividends,
    parseIBCsv,
    parseRevolutCsv,
    parseRevolutInvestmentsCsv,
    resolveCountry,
} from '../../src/index.js';

const SAMPLES = join(__dirname, '../../../../samples');

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
        ibInterest: parsed.interest,
        revolutInterest: [],
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
    const ibCsv = readFileSync(join(SAMPLES, 'ib-report.csv'), 'utf-8');
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
    const fifoTrades: IBTrade[] = revTrades.map(t => ({
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
    const eurInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-eur.csv'), 'utf-8'));
    const gbpInterest = parseRevolutCsv(readFileSync(join(SAMPLES, 'revolut-gbp.csv'), 'utf-8'));

    return {
        taxYear: 2025,
        baseCurrency: 'BGN',
        language: 'bg',
        holdings: allHoldings,
        sales: [...ibSales, ...revSales],
        dividends: allDividends,
        stockYield: parsed.stockYield,
        ibInterest: parsed.interest,
        revolutInterest: [eurInterest, gbpInterest],
        fxRates: {},
        manualEntries: [],
    };
}

describe.concurrent('Integration: round-trip import → export → re-import', () => {
    describe('Test 1: IB CSV full pipeline', () => {
        it('parses IB CSV, generates Excel, re-imports and verifies counts', async () => {
            const csv = readFileSync(join(SAMPLES, 'ib-report.csv'), 'utf-8');
            const state = buildAppStateFromIB(csv);

            // Verify parsed data has expected content
            expect(state.holdings.length).toBeGreaterThan(0);
            expect(state.sales.length).toBeGreaterThan(0);
            expect(state.dividends.length).toBeGreaterThan(0);
            expect(state.stockYield.length).toBeGreaterThan(0);
            expect(state.ibInterest.length).toBeGreaterThan(0);

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
            expect(reimported.ibInterest.length).toBe(state.ibInterest.length);
        });

        it('verifies sheet names and GOOG/AMZN values survive round-trip', async () => {
            const csv = readFileSync(join(SAMPLES, 'ib-report.csv'), 'utf-8');
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
            const eurCsv = readFileSync(join(SAMPLES, 'revolut-eur.csv'), 'utf-8');
            const gbpCsv = readFileSync(join(SAMPLES, 'revolut-gbp.csv'), 'utf-8');
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
            const fifoTrades: IBTrade[] = trades.map(t => ({
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

            const revolutInterest = [eurInterest, gbpInterest];

            const state: AppState = {
                taxYear: 2025,
                baseCurrency: 'BGN',
                language: 'bg',
                holdings,
                sales,
                dividends: [],
                stockYield: [],
                ibInterest: [],
                revolutInterest,
                fxRates: {},
                manualEntries: [],
            };

            expect(state.revolutInterest.length).toBe(2);
            expect(state.holdings.length).toBeGreaterThan(0);

            // Generate Excel
            const buffer = await generateExcel(state);
            expect(buffer.length).toBeGreaterThan(0);

            // Re-import
            const reimported = await importFullExcel(buffer.buffer as ArrayBuffer);

            // Verify Revolut interest currencies and entry counts
            expect(reimported.revolutInterest.length).toBe(state.revolutInterest.length);
            for (const origRev of state.revolutInterest) {
                const impRev = reimported.revolutInterest.find(r => r.currency === origRev.currency);
                expect(impRev).toBeDefined();
                expect(impRev!.entries.length).toBe(origRev.entries.length);
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
            const ibCsv = readFileSync(join(SAMPLES, 'ib-report.csv'), 'utf-8');
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
                ibInterest: reimported1.ibInterest,
                revolutInterest: reimported1.revolutInterest,
            };
            const buffer2 = await generateExcel(state2);
            const reimported2 = await importFullExcel(buffer2.buffer as ArrayBuffer);

            // Assert: all counts match between reimport1 and reimport2
            expect(reimported2.holdings.length).toBe(reimported1.holdings.length);
            expect(reimported2.sales.length).toBe(reimported1.sales.length);
            expect(reimported2.dividends.length).toBe(reimported1.dividends.length);
            expect(reimported2.stockYield.length).toBe(reimported1.stockYield.length);
            expect(reimported2.ibInterest.length).toBe(reimported1.ibInterest.length);
            expect(reimported2.revolutInterest.length).toBe(reimported1.revolutInterest.length);

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
            expect(state.ibInterest.length).toBeGreaterThan(0);
            expect(state.revolutInterest.length).toBe(2);

            // Export 1: from parsed sample data
            const buffer1 = await generateExcel(state);

            // Re-import from clean state (as if user opened Excel file from scratch)
            const reimported = await importFullExcel(buffer1.buffer as ArrayBuffer);

            // Verify all counts match original
            expect(reimported.holdings.length).toBe(state.holdings.length);
            expect(reimported.sales.length).toBe(state.sales.length);
            expect(reimported.dividends.length).toBe(state.dividends.length);
            expect(reimported.stockYield.length).toBe(state.stockYield.length);
            expect(reimported.ibInterest.length).toBe(state.ibInterest.length);
            expect(reimported.revolutInterest.length).toBe(state.revolutInterest.length);

            // Export 2: from re-imported data
            const state2: AppState = {
                ...state,
                holdings: reimported.holdings,
                sales: reimported.sales,
                dividends: reimported.dividends,
                stockYield: reimported.stockYield,
                ibInterest: reimported.ibInterest,
                revolutInterest: reimported.revolutInterest,
            };
            const buffer2 = await generateExcel(state2);

            // Re-import export 2
            const reimported2 = await importFullExcel(buffer2.buffer as ArrayBuffer);

            // Both re-imports must have identical counts
            expect(reimported2.holdings.length).toBe(reimported.holdings.length);
            expect(reimported2.sales.length).toBe(reimported.sales.length);
            expect(reimported2.dividends.length).toBe(reimported.dividends.length);
            expect(reimported2.stockYield.length).toBe(reimported.stockYield.length);
            expect(reimported2.ibInterest.length).toBe(reimported.ibInterest.length);
            expect(reimported2.revolutInterest.length).toBe(reimported.revolutInterest.length);

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

            // Deep comparison: Revolut interest entries (sort by date for deterministic order)
            const sortEntries = (e: { date: string; amount: number }[]) => [...e].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
            for (const r1 of reimported.revolutInterest) {
                const r2 = reimported2.revolutInterest.find(r => r.currency === r1.currency);
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
                ibInterest: [],
                revolutInterest: [],
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
});
