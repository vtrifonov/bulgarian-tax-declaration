import {
    calcDividendTax,
    FifoEngine,
    FxService,
    InMemoryFxCache,
    isBinaryHandler,
    matchWhtToDividends,
    parseIBCsv,
    parseRevolutCsv,
    parseRevolutInvestmentsCsv,
    parseRevolutSavingsPositions,
    populateSaleFxRates,
    providers,
    resolveCountries,
    resolveIsinSync,
    splitOpenPositions,
    t,
} from '@bg-tax/core';
import type {
    BrokerInterest,
    BrokerProviderResult,
    Holding,
    IBParsedData,
} from '@bg-tax/core';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppStore } from '../store/app-state';
import type { ImportedFile } from '../store/app-state';

/** Get a fetch function that bypasses CORS — Tauri HTTP plugin in app, Vite proxy in browser */
function getCorsFetch(): typeof fetch {
    const isTauri = '__TAURI_INTERNALS__' in window;

    if (isTauri) {
        // Lazy wrapper that dynamically imports Tauri HTTP plugin on first call
        return (async (url: RequestInfo | URL, init?: RequestInit) => {
            const mod = await import('@tauri-apps/plugin-http');

            return mod.fetch(url, init);
        }) as typeof fetch;
    }

    // In browser dev mode, proxy OpenFIGI through Vite to avoid CORS
    return ((url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        const proxied = urlStr.replace('https://api.openfigi.com', '/api/openfigi');

        return fetch(proxied, init);
    }) as typeof fetch;
}

/** Fill missing ISINs on holdings using the global ISIN cache. Shared across all providers. */
function fillMissingIsins(holdings: Holding[]): void {
    for (const h of holdings) {
        if (!h.isin) {
            h.isin = resolveIsinSync(h.symbol);
        }
    }
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

function detectFileType(content: string, filename: string): ImportedFile['type'] | null {
    // IB Activity statement
    if (content.startsWith('Statement,Header,Field Name') || content.includes('Trades,Header,DataDiscriminator')) {
        return 'ib';
    }

    // Revolut Savings interest statement
    if (filename.startsWith('savings-statement') || content.includes('Interest PAID')) {
        return 'revolut';
    }

    // Revolut account statement (current account with balance column)
    if (content.startsWith('Type,Product,Started Date') && content.includes('Balance')) {
        return 'revolut-account';
    }

    // Revolut Investments yearly statement
    if (content.startsWith('Date,Ticker,Type')) {
        return 'revolut-investments';
    }

    return null;
}

function importPriority(type: ImportedFile['type'] | null): number {
    switch (type) {
        case 'ib':
            return 10;
        case 'revolut-investments':
            return 20;
        case 'revolut-account':
            return 30;
        case 'revolut':
            return 40;
        case 'etrade':
            return 50;
        default:
            return 999;
    }
}

export function Import() {
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [fxProgress, setFxProgress] = useState<
        {
            active: boolean;
            completed: number;
            total: number;
            current: string;
        } | null
    >(null);
    const [pendingSavingsBalances, setPendingSavingsBalances] = useState<{
        isin: string;
        currency: string;
        quantityEndOfYear: number;
        openingBalance: string;
        closingBalance: string;
        fileName: string;
    }[]>([]);

    const [bankAccounts, setBankAccounts] = useState<{
        broker: string;
        currency: string;
        openingBalance: string;
        closingBalance: string;
    }[]>([]);

    const {
        importHoldings,
        importSales,
        importDividends,
        importStockYield,
        importBrokerInterest,
        setFxRates,
        taxYear,
        baseCurrency,
        holdings,
        sales,
        dividends,
        stockYield,
        brokerInterest,
        importedFiles,
        addImportedFile,
        foreignAccounts,
        setForeignAccounts,
        setSavingsSecurities,
    } = useAppStore();

    // Derive broker names from imported files
    const importedBrokers = useMemo(() => {
        const brokers = new Set<string>();
        for (const f of importedFiles) {
            if (f.type === 'ib') brokers.add('Interactive Brokers');
            if (f.type === 'revolut' || f.type === 'revolut-investments' || f.type === 'revolut-account') brokers.add('Revolut');
            if (f.type === 'etrade') brokers.add('E*TRADE');
        }
        return Array.from(brokers).sort();
    }, [importedFiles]);

    // Common currencies + any seen in imported data
    const availableCurrencies = useMemo(() => {
        const ccys = new Set(['USD', 'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'JPY', 'CAD', 'AUD']);
        for (const h of holdings) ccys.add(h.currency);
        for (const s of sales) ccys.add(s.currency);
        for (const bi of brokerInterest) ccys.add(bi.currency);
        return Array.from(ccys).sort();
    }, [holdings, sales, brokerInterest]);

    // Auto-fetch FX rates when new currencies are detected — includes prior-year dates
    useEffect(() => {
        const state = useAppStore.getState();
        const currencies = new Set<string>();
        const years = new Set([taxYear]);

        // Helper to extract year from date string (YYYY-MM-DD)
        function addYear(dateStr: string | undefined): void {
            if (dateStr) {
                const yr = parseInt(dateStr.substring(0, 4));

                if (!isNaN(yr)) {
                    years.add(yr);
                }
            }
        }

        // Collect all currencies and years from holdings, sales, dividends, etc.
        for (const h of state.holdings) {
            if (h.currency) {
                currencies.add(h.currency);
            }
            addYear(h.dateAcquired);
        }

        for (const s of state.sales) {
            if (s.currency) {
                currencies.add(s.currency);
            }
            addYear(s.dateAcquired);
            addYear(s.dateSold);
        }

        for (const d of state.dividends) {
            if (d.currency) {
                currencies.add(d.currency);
            }
            addYear(d.date);
        }

        for (const s of state.stockYield) {
            if (s.currency) {
                currencies.add(s.currency);
            }
        }

        for (const bi of state.brokerInterest) {
            if (bi.currency) {
                currencies.add(bi.currency);
            }

            for (const entry of bi.entries) {
                addYear(entry.date);
            }
        }

        // Also fetch prior year for holiday/weekend fallback (e.g. Jan 1 needs Dec 31 rate)
        const yearsList = [...years];

        for (const yr of yearsList) {
            if (yr > 2020) {
                years.add(yr - 1);
            }
        }

        const needed = [...currencies].filter(c => c !== 'BGN' && c !== 'EUR');

        if (needed.length === 0) {
            return;
        }

        // Check if we need to fetch any missing year+currency combo
        const yearsArr = [...years].filter(y => y >= 1999 && y <= taxYear + 1).sort();
        let hasMissing = false;

        for (const ccy of needed) {
            for (const yr of yearsArr) {
                const dateToCheck = `${yr}-06-15`;

                if (!state.fxRates[ccy]?.[dateToCheck]) {
                    hasMissing = true;
                    break;
                }
            }

            if (hasMissing) {
                break;
            }
        }

        if (!hasMissing) {
            return;
        }

        const fxService = new FxService(new InMemoryFxCache(), baseCurrency);
        const tasks: { currency: string; year: number }[] = [];

        for (const ccy of needed) {
            for (const yr of yearsArr) {
                tasks.push({ currency: ccy, year: yr });
            }
        }
        setFxProgress({ active: true, completed: 0, total: tasks.length, current: '' });

        void (async () => {
            try {
                const merged: Record<string, Record<string, number>> = {};

                for (let i = 0; i < tasks.length; i++) {
                    const { currency, year } = tasks[i];

                    setFxProgress(p => p && { ...p, completed: i, current: `${currency} ${year}` });
                    try {
                        const rates = await fxService.fetchRates([currency], year);

                        for (const [ccy, dateRates] of Object.entries(rates)) {
                            merged[ccy] = { ...merged[ccy], ...dateRates };
                        }
                    } catch { /* skip failed */ }
                }
                setFxProgress(p => p && { ...p, completed: tasks.length, current: '' });

                if (Object.keys(merged).length > 0) {
                    setFxRates(merged);

                    // Populate FX rates on existing sales
                    const currentState = useAppStore.getState();

                    if (currentState.sales.length > 0) {
                        const allRates: Record<string, Record<string, number>> = {};

                        for (const ccy in currentState.fxRates) {
                            allRates[ccy] = { ...currentState.fxRates[ccy] };
                        }

                        for (const ccy in merged) {
                            allRates[ccy] = { ...allRates[ccy], ...merged[ccy] };
                        }
                        const getRate = (currency: string, date: string) => allRates[currency]?.[date];
                        const updated = populateSaleFxRates(currentState.sales, getRate, baseCurrency);

                        importSales(updated);
                    }
                }
            } catch (err) {
                console.error('FX fetch failed:', err);
            } finally {
                setFxProgress(null);
            }
        })();
    }, [importedFiles.length, baseCurrency, taxYear, importSales, setFxRates]); // Re-run after file import or settings change

    const processEtradeResult = useCallback(async (
        result: BrokerProviderResult,
        file: File,
    ) => {
        const source = { type: 'E*TRADE', file: file.name };
        const { taxYear: currentTaxYear } = useAppStore.getState();

        // Interest (MMF distributions) — append new entries, deduplicate by (date, amount)
        if (result.interest && result.interest.length > 0) {
            const entriesWithSource = result.interest.map(e => ({ ...e, source }));
            const allBrokerInterest = useAppStore.getState().brokerInterest;
            const existingEtrade = allBrokerInterest.find(bi => bi.broker === 'E*TRADE');
            const otherBrokers = allBrokerInterest.filter(bi => bi.broker !== 'E*TRADE');

            // Merge: keep existing E*TRADE entries + add new ones that aren't duplicates
            const existingEntries = existingEtrade?.entries ?? [];
            const existingKeys = new Set(existingEntries.map(e => `${e.date}|${e.amount}`));
            const newEntries = entriesWithSource.filter(e => !existingKeys.has(`${e.date}|${e.amount}`));
            const mergedEntries = [...existingEntries, ...newEntries];

            const etradeInterest = {
                broker: 'E*TRADE',
                currency: 'USD',
                entries: mergedEntries,
            };
            importBrokerInterest([...otherBrokers, etradeInterest]);
        }

        // Holdings (open positions)
        if (result.openPositions && result.openPositions.length > 0) {
            const hasPriorHoldings = useAppStore.getState().holdings.some(h => h.source?.type !== 'E*TRADE');
            const countryMap = await resolveCountries(
                result.openPositions.map(p => ({ symbol: p.symbol, currency: p.currency })),
                getCorsFetch(),
            );

            const currentHoldings = useAppStore.getState().holdings;
            const newHoldings = splitOpenPositions(result.openPositions, [], {
                broker: 'E*TRADE',
                countryMap,
                source,
                taxYear: currentTaxYear,
                symbolAliases: {},
                skipPreExisting: hasPriorHoldings,
                existingHoldings: currentHoldings.map(h => ({ symbol: h.symbol, broker: h.broker })),
            });

            // Fill missing ISINs (needed for SPB-8)
            fillMissingIsins(newHoldings);

            // Replace E*TRADE holdings, keep others
            const existingNonEtrade = useAppStore.getState().holdings.filter(h => h.source?.type !== 'E*TRADE');
            importHoldings([...existingNonEtrade, ...newHoldings]);
        }

        // Dividends (equity dividends with WHT) — append and deduplicate across quarterly PDFs
        if (result.dividends && result.dividends.length > 0) {
            const divSymbols = result.dividends.map(d => ({ symbol: d.symbol, currency: d.currency }));
            const divCountryMap = await resolveCountries(divSymbols, getCorsFetch());

            for (const d of result.dividends) {
                d.country = divCountryMap[d.symbol] ?? 'US';
                d.source = source;
                const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);
                d.bgTaxDue = bgTaxDue;
                d.whtCredit = whtCredit;
            }

            const existingDividends = useAppStore.getState().dividends;
            const existingKeys = new Set(
                existingDividends
                    .filter(d => d.source?.type === 'E*TRADE')
                    .map(d => `${d.date}|${d.symbol}|${d.grossAmount}`),
            );
            const newDividends = result.dividends.filter(
                d => !existingKeys.has(`${d.date}|${d.symbol}|${d.grossAmount}`),
            );
            importDividends([...existingDividends, ...newDividends]);
        }

        // Foreign account balance (cash) — merge with existing E*TRADE balance:
        // Keep the earliest start-of-year (from Q1) and latest end-of-year (from Q4)
        if (result.foreignAccounts && result.foreignAccounts.length > 0) {
            const currentAccounts = useAppStore.getState().foreignAccounts ?? [];
            const existingEtradeCash = currentAccounts.find(a => a.broker === 'E*TRADE');
            const newCash = result.foreignAccounts[0];

            const mergedCash = existingEtradeCash
                ? {
                    ...newCash,
                    // Keep the smaller start (Q1's prior-year-end balance is the start of year)
                    amountStartOfYear: Math.min(existingEtradeCash.amountStartOfYear, newCash.amountStartOfYear),
                    // Keep the larger end (Q4's end balance is the end of year)
                    amountEndOfYear: Math.max(existingEtradeCash.amountEndOfYear, newCash.amountEndOfYear),
                }
                : newCash;

            const filtered = currentAccounts.filter(a => a.broker !== 'E*TRADE');
            setForeignAccounts([...filtered, mergedCash]);
        }

        // Success message
        const parts: string[] = [];
        if (result.openPositions?.length) parts.push(`${result.openPositions.length} holdings`);
        if (result.dividends?.length) parts.push(`${result.dividends.length} dividends`);
        if (result.interest?.length) parts.push(`${result.interest.length} interest entries`);
        if (result.foreignAccounts?.length) parts.push('cash balance');
        if (result.warnings?.length) parts.push(`${result.warnings.length} warnings`);

        const msg = parts.join(', ') || 'No data found in statement';

        addImportedFile({
            name: file.name,
            type: 'etrade',
            status: 'success',
            message: `${msg} (Note: trades are not yet supported for E*TRADE)`,
        });
    }, [importHoldings, importBrokerInterest, addImportedFile, setForeignAccounts]);

    const processFile = useCallback(async (file: File) => {
        // Binary file path (PDF)
        if (file.name.toLowerCase().endsWith('.pdf')) {
            try {
                if (file.size > 10 * 1024 * 1024) {
                    addImportedFile({
                        name: file.name,
                        type: 'etrade',
                        status: 'error',
                        message: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum 10MB allowed.`,
                    });
                    return;
                }

                const buffer = await file.arrayBuffer();

                for (const provider of providers) {
                    for (const handler of provider.fileHandlers) {
                        if (isBinaryHandler(handler) && handler.detectBinary(buffer, file.name)) {
                            const result = await handler.parseBinary(buffer);
                            await processEtradeResult(result, file);
                            return;
                        }
                    }
                }

                // No binary handler matched this PDF
                addImportedFile({
                    name: file.name,
                    type: 'etrade',
                    status: 'error',
                    message: 'Unrecognized PDF format. Only E*TRADE Client Statements (PDF) are currently supported.',
                });
                return;
            } catch (err) {
                addImportedFile({
                    name: file.name,
                    type: 'etrade',
                    status: 'error',
                    message: `PDF parse error: ${err instanceof Error ? err.message : String(err)}`,
                });
                return;
            }
        }

        // Existing text file path (CSV) — keep everything below unchanged
        const content = await file.text();
        const fileType = detectFileType(content, file.name);

        if (!fileType) {
            addImportedFile({
                name: file.name,
                type: 'ib',
                status: 'error',
                message: 'Unrecognized file format. Expected IB activity statement, Revolut savings CSV, or Revolut investments CSV.',
            });

            return;
        }

        try {
            if (fileType === 'ib') {
                const parsed: IBParsedData = parseIBCsv(content);

                // Check for duplicate IB holdings
                const duplicateHoldings: Set<string> = new Set();

                for (const trade of parsed.trades) {
                    const tradeDate = trade.dateTime.split(' ')[0]; // Extract YYYY-MM-DD from "YYYY-MM-DD HH:MM:SS"

                    for (const existingHolding of useAppStore.getState().holdings) {
                        if (
                            existingHolding.broker === 'IB'
                            && existingHolding.symbol === trade.symbol
                            && existingHolding.dateAcquired === tradeDate
                            && existingHolding.quantity === Math.abs(trade.quantity)
                        ) {
                            duplicateHoldings.add(`${trade.symbol}-${tradeDate}-${trade.quantity}`);
                        }
                    }
                }

                // Match WHT to dividends
                const { matched, unmatched } = matchWhtToDividends(parsed.dividends, parsed.withholdingTax);
                const allDividends = [...matched, ...unmatched];

                // Collect all symbols and resolve countries (async — uses OpenFIGI fallback for unknowns)
                const allSymbols: { symbol: string; currency: string }[] = [];

                for (const t of parsed.trades) {
                    allSymbols.push({ symbol: t.symbol, currency: t.currency });
                }

                for (const d of allDividends) {
                    allSymbols.push({ symbol: d.symbol, currency: d.currency });
                }

                for (const p of parsed.openPositions) {
                    allSymbols.push({ symbol: p.symbol, currency: p.currency });
                }

                // Also resolve countries for existing holdings (from prior-year import)
                for (const h of useAppStore.getState().holdings) {
                    if (!h.country && h.symbol) {
                        allSymbols.push({ symbol: h.symbol, currency: h.currency });
                    }
                }
                const countryMap = await resolveCountries(allSymbols, getCorsFetch(), parsed.symbolExchanges);

                // Calculate BG tax for dividends
                for (const d of allDividends) {
                    d.country = countryMap[d.symbol] ?? '';
                    const { bgTaxDue, whtCredit } = calcDividendTax(d.grossAmount, d.withholdingTax);

                    d.bgTaxDue = bgTaxDue;
                    d.whtCredit = whtCredit;
                    d.source = { type: 'IB', file: file.name };
                }
                importDividends(allDividends);

                for (const s of parsed.stockYield) {
                    s.source = { type: 'IB', file: file.name };
                }
                importStockYield(parsed.stockYield);

                for (const i of parsed.interest) {
                    i.source = { type: 'IB', file: file.name };
                }
                // Group IB interest by currency
                const ibByCurrency = new Map<string, typeof parsed.interest>();

                for (const entry of parsed.interest) {
                    const ccy = entry.currency || 'USD';

                    if (!ibByCurrency.has(ccy)) {
                        ibByCurrency.set(ccy, []);
                    }
                    ibByCurrency.get(ccy)!.push(entry);
                }
                const ibInterestList = Array.from(ibByCurrency).map(([currency, entries]) => ({
                    broker: 'IB' as const,
                    currency,
                    entries,
                }));

                if (ibInterestList.length > 0) {
                    const existingInterest = useAppStore.getState().brokerInterest.filter(bi => bi.broker !== 'IB');

                    importBrokerInterest([...existingInterest, ...ibInterestList]);
                }

                // FIFO: process all trades (buys + sells) against existing holdings
                const currentHoldings = useAppStore.getState().holdings;
                const sellTrades = parsed.trades.filter(t => t.quantity < 0);
                const fifo = new FifoEngine([...currentHoldings]);
                const { holdings: fifoHoldings, consumedHoldings: fifoConsumed, sales: newSales, warnings } = fifo.processTrades(sellTrades, 'IB', countryMap);
                const existingIds = new Set(currentHoldings.map(h => h.id));
                const consumedExisting = fifoConsumed.filter(h => existingIds.has(h.id));

                for (const s of newSales) {
                    if (!s.source) {
                        s.source = { type: 'IB', file: file.name };
                    }
                }

                for (const h of consumedExisting) {
                    if (!h.source) {
                        h.source = { type: 'IB', file: file.name };
                    }
                }
                importSales(newSales);

                // Use Open Positions as authoritative year-end holdings (if available)
                // If prior-year holdings exist, only add this year's buy lots (skip pre-existing)
                const hasPriorHoldings = useAppStore.getState().holdings.some(h => h.source?.type !== 'IB');
                let finalHoldings: Holding[];
                let allHoldings: Holding[];

                if (parsed.openPositions.length > 0) {
                    const ibExistingHoldings = currentHoldings.map(h => ({ symbol: h.symbol, broker: h.broker }));
                    const statementHoldings = splitOpenPositions(parsed.openPositions, parsed.trades, {
                        broker: 'IB',
                        countryMap,
                        source: { type: 'IB', file: file.name },
                        taxYear,
                        symbolAliases: parsed.symbolAliases,
                        skipPreExisting: hasPriorHoldings,
                        existingHoldings: ibExistingHoldings,
                    });
                    finalHoldings = statementHoldings;
                    allHoldings = [
                        ...mergeFifoResultsWithExistingHoldings(currentHoldings, fifoHoldings, fifoConsumed),
                        ...statementHoldings,
                    ];
                } else {
                    const currentStatementFifo = new FifoEngine([]);
                    const { holdings: currentStatementHoldings } = currentStatementFifo.processTrades(parsed.trades, 'IB', countryMap);

                    finalHoldings = [
                        ...mergeFifoResultsWithExistingHoldings(currentHoldings, fifoHoldings, fifoConsumed),
                        ...currentStatementHoldings,
                    ];
                    allHoldings = finalHoldings;

                    for (const h of finalHoldings.filter(h => !existingIds.has(h.id))) {
                        if (!h.source) {
                            h.source = { type: 'IB', file: file.name };
                        }
                    }
                }
                // Merge: keep non-IB holdings (with symbol + country normalization), replace IB holdings
                const existingNonIb = currentHoldings.filter(h => h.source?.type !== 'IB');

                for (const h of existingNonIb) {
                    // Normalize "CSPX/SXR8" style symbols from prior-year imports
                    if (h.symbol.includes('/')) {
                        const parts = h.symbol.split('/');

                        for (const part of parts) {
                            const resolved = parsed.symbolAliases[part.trim()];

                            if (resolved) {
                                h.symbol = resolved;
                                break;
                            }

                            if (parsed.openPositions.some(p => p.symbol === part.trim())) {
                                h.symbol = part.trim();
                                break;
                            }
                        }
                    }

                    // Fill missing country from resolved map
                    if (!h.country) {
                        h.country = countryMap[h.symbol] ?? '';
                    }
                }
                if (parsed.isinMap) {
                    for (const h of allHoldings) {
                        if (!h.isin && parsed.isinMap[h.symbol]) {
                            h.isin = parsed.isinMap[h.symbol];
                        }
                    }
                }
                fillMissingIsins(allHoldings);
                importHoldings(allHoldings);

                // Store foreign account balances from IB Cash Report (for SPB-8)
                if (parsed.cashBalances && parsed.cashBalances.length > 0) {
                    const ibCountry = parsed.brokerName?.includes('Ireland') ? 'IE' : 'US';
                    const ibAccounts = parsed.cashBalances.map(b => ({
                        broker: parsed.brokerName ?? 'Interactive Brokers',
                        type: '03' as const,
                        maturity: 'L' as const,
                        country: ibCountry,
                        currency: b.currency,
                        amountStartOfYear: b.amountStartOfYear,
                        amountEndOfYear: b.amountEndOfYear,
                    }));

                    const currentAccounts = useAppStore.getState().foreignAccounts ?? [];

                    setForeignAccounts([...currentAccounts.filter(a => a.broker !== (parsed.brokerName ?? 'Interactive Brokers')), ...ibAccounts]);
                }

                const buys = parsed.trades.filter(t => t.quantity > 0).length;
                const sells = parsed.trades.filter(t => t.quantity < 0).length;
                const warnMsg = warnings.length > 0 ? ` (${warnings.length} warnings)` : '';
                const dupMsg = duplicateHoldings.size > 0 ? ` [WARNING: ${duplicateHoldings.size} potential duplicate holdings detected]` : '';
                const holdingsSource = parsed.openPositions.length > 0 ? 'Open Positions' : 'FIFO';

                addImportedFile({
                    name: file.name,
                    type: 'ib',
                    status: 'success',
                    message:
                        `${buys} buys, ${sells} sells → ${newSales.length} matched sales, ${finalHoldings.length} holdings (${holdingsSource}), ${allDividends.length} dividends, ${parsed.stockYield.length} stock yield, ${parsed.interest.length} interest${warnMsg}${dupMsg}`,
                });
            } else if (fileType === 'revolut-investments') {
                const { trades, holdings: parsedHoldings } = parseRevolutInvestmentsCsv(content);

                if (parsedHoldings.length === 0 && trades.length === 0) {
                    addImportedFile({
                        name: file.name,
                        type: 'revolut-investments',
                        status: 'error',
                        message: 'No trades found in this file.',
                    });

                    return;
                }

                // Resolve countries (async — uses OpenFIGI fallback for unknowns)
                const countryMap = await resolveCountries(
                    trades.map(t => ({ symbol: t.ticker, currency: t.currency })),
                    getCorsFetch(),
                );

                // Convert trades to the format FifoEngine expects
                const fifoTrades = trades.map(t => ({
                    symbol: t.ticker,
                    dateTime: t.date,
                    quantity: t.type.includes('SELL') ? -t.quantity : t.quantity,
                    price: t.pricePerShare,
                    proceeds: t.type.includes('SELL') ? t.totalAmount : 0,
                    commission: 0,
                    currency: t.currency,
                }));

                const currentHoldings = useAppStore.getState().holdings;
                const sellTrades = fifoTrades.filter(t => t.quantity < 0);
                const fifo = new FifoEngine([...currentHoldings]);
                const { holdings: updatedExistingHoldings, consumedHoldings: revConsumed, sales: newSales, warnings } = fifo.processTrades(sellTrades, 'Revolut', countryMap);
                const existingIds = new Set(currentHoldings.map(h => h.id));
                const consumedExisting = revConsumed.filter(h => existingIds.has(h.id));

                for (const h of parsedHoldings) {
                    if (!h.country) {
                        h.country = countryMap[h.symbol] ?? '';
                    }
                    if (!h.source) {
                        h.source = { type: 'Revolut', file: file.name };
                    }
                }
                fillMissingIsins(parsedHoldings);

                for (const s of newSales) {
                    if (!s.source) {
                        s.source = { type: 'Revolut', file: file.name };
                    }
                }

                for (const h of consumedExisting) {
                    if (!h.source) {
                        h.source = { type: 'Revolut', file: file.name };
                    }
                }
                importHoldings([
                    ...mergeFifoResultsWithExistingHoldings(currentHoldings, updatedExistingHoldings, revConsumed),
                    ...parsedHoldings,
                ]);

                // Merge: keep non-Revolut sales, add Revolut sales
                const existingSales = useAppStore.getState().sales.filter(s => s.source?.type !== 'Revolut');

                importSales([...existingSales, ...newSales]);

                const buys = trades.filter(t => t.type.includes('BUY')).length;
                const sells = trades.filter(t => t.type.includes('SELL')).length;
                const warnMsg = warnings.length > 0 ? ` (${warnings.length} warnings)` : '';

                addImportedFile({
                    name: file.name,
                    type: 'revolut-investments',
                    status: 'success',
                    message: `${buys} buys, ${sells} sells → ${newSales.length} matched sales, ${parsedHoldings.length} remaining holdings${warnMsg}`,
                });
            } else if (fileType === 'revolut-account') {
                const { parseRevolutAccountStatement } = await import('@bg-tax/core');
                const account = parseRevolutAccountStatement(content);
                // Read latest state directly to avoid stale closure when multiple files imported
                const existing = useAppStore.getState().foreignAccounts ?? [];
                // Replace any existing Revolut account with same currency
                const filtered = existing.filter(a => !(a.broker === 'Revolut' && a.currency === account.currency));

                setForeignAccounts([...filtered, account]);
                addImportedFile({
                    name: file.name,
                    type: 'revolut-account',
                    status: 'success',
                    message: `${account.currency}: start ${account.amountStartOfYear.toFixed(2)}, end ${account.amountEndOfYear.toFixed(2)}`,
                });
            } else {
                const revolut: BrokerInterest = parseRevolutCsv(content);
                const existing = useAppStore.getState().brokerInterest;

                // Check for duplicate Revolut currency
                const isDuplicate = existing.some(bi => bi.broker === 'Revolut' && bi.currency === revolut.currency);

                if (isDuplicate) {
                    addImportedFile({
                        name: file.name,
                        type: 'revolut',
                        status: 'error',
                        message: `This file appears to already be imported (${revolut.currency} already exists). Skipping to prevent duplicates.`,
                    });

                    return;
                }

                for (const e of revolut.entries) {
                    e.source = { type: 'Revolut', file: file.name };
                }
                const brokerInterestEntry = {
                    broker: 'Revolut' as const,
                    currency: revolut.currency,
                    entries: revolut.entries,
                };

                importBrokerInterest([...existing, brokerInterestEntry]);

                const netInterest = revolut.entries.reduce((sum, e) => sum + e.amount, 0);

                addImportedFile({
                    name: file.name,
                    type: 'revolut',
                    status: 'success',
                    message: `${revolut.currency}: ${revolut.entries.length} entries, net ${netInterest.toFixed(2)} ${revolut.currency}`,
                });

                // Extract position data for balance prompt
                const position = parseRevolutSavingsPositions(content);
                setPendingSavingsBalances(prev => [
                    ...prev.filter(p => !(p.isin === position.isin && p.currency === position.currency)),
                    {
                        isin: position.isin,
                        currency: position.currency,
                        quantityEndOfYear: position.quantityEndOfYear,
                        openingBalance: '',
                        closingBalance: position.quantityEndOfYear.toFixed(2),
                        fileName: file.name,
                    },
                ]);
            }
        } catch (err) {
            addImportedFile({
                name: file.name,
                type: fileType,
                status: 'error',
                message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    }, [importHoldings, importSales, importDividends, importStockYield, importBrokerInterest, addImportedFile, taxYear, setForeignAccounts, processEtradeResult]);

    const processFiles = useCallback((files: FileList | File[]) => {
        void (async () => {
            const supported = Array.from(files).filter(file => file.name.endsWith('.csv') || file.name.endsWith('.pdf'));
            const unsupported = Array.from(files).filter(file => !file.name.endsWith('.csv') && !file.name.endsWith('.pdf'));

            for (const file of unsupported) {
                addImportedFile({
                    name: file.name,
                    type: 'ib',
                    status: 'error',
                    message: 'Only .csv and .pdf files are supported',
                });
            }

            const withPriority = await Promise.all(supported.map(async (file) => {
                if (file.name.toLowerCase().endsWith('.pdf')) {
                    return { file, priority: importPriority('etrade') };
                }

                const content = await file.text();

                return { file, priority: importPriority(detectFileType(content, file.name)) };
            }));

            withPriority.sort((a, b) => a.priority - b.priority || a.file.name.localeCompare(b.file.name));

            for (const { file } of withPriority) {
                await processFile(file);
            }
        })();
    }, [processFile, addImportedFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        if (e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files);
        }
    }, [processFiles]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }, []);

    const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            processFiles(e.target.files);
            e.target.value = ''; // Reset so same file can be re-selected
        }
    }, [processFiles]);

    return (
        <div style={{ padding: '2rem' }}>
            <h1>{t('page.import')}</h1>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'start' }}>
                {/* Left column: drop zone + files + continue */}
                <div>
                    {/* Drop zone */}
                    <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        style={{
                            border: `3px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: '12px',
                            padding: '1.5rem 2rem',
                            textAlign: 'center',
                            backgroundColor: isDragOver ? 'var(--drop-bg)' : 'var(--card-bg)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            marginBottom: '1.5rem',
                        }}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
                            {isDragOver ? '📂' : '📄'}
                        </div>
                        <p style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>
                            {isDragOver ? t('import.dropHere') : t('import.dragDrop')}
                        </p>
                        <p style={{ color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>{t('import.or')}</p>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                            style={{
                                padding: '0.6rem 1.5rem',
                                fontSize: '1rem',
                                backgroundColor: 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                            }}
                        >
                            {t('button.browseFiles')}
                        </button>
                        <input
                            ref={fileInputRef}
                            type='file'
                            accept='.csv,.pdf'
                            multiple
                            onChange={handleFileInput}
                            style={{ display: 'none' }}
                        />
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '1rem', marginBottom: 0 }}>
                            {t('import.supported')}
                        </p>
                    </div>

                    {/* FX Rate loading indicator */}
                    {fxProgress?.active && (
                        <div
                            style={{
                                padding: '0.75rem 1rem',
                                marginBottom: '1rem',
                                borderRadius: '6px',
                                backgroundColor: 'var(--drop-bg)',
                                border: '1px solid var(--accent)',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <div
                                    style={{
                                        width: '16px',
                                        height: '16px',
                                        border: '2px solid var(--accent)',
                                        borderTopColor: 'transparent',
                                        borderRadius: '50%',
                                        animation: 'spin 0.8s linear infinite',
                                    }}
                                />
                                <span>
                                    {t('import.fetchingFx')}
                                    {fxProgress.current && `: ${fxProgress.current}`}
                                    {` (${fxProgress.completed}/${fxProgress.total})`}
                                </span>
                            </div>
                            <div style={{ height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div
                                    style={{
                                        height: '100%',
                                        width: `${fxProgress.total > 0 ? (fxProgress.completed / fxProgress.total) * 100 : 0}%`,
                                        backgroundColor: 'var(--accent)',
                                        borderRadius: '2px',
                                        transition: 'width 0.3s ease',
                                    }}
                                />
                            </div>
                            <style>
                                {`
                        @keyframes spin { to { transform: rotate(360deg); } }
                    `}
                            </style>
                        </div>
                    )}

                    {/* Current session data summary */}
                    {(holdings.length > 0 || sales.length > 0 || dividends.length > 0 || stockYield.length > 0 || brokerInterest.length > 0) && (() => {
                        const sourceFiles = new Set<string>();

                        for (const h of holdings) {
                            if (h.source?.file) {
                                sourceFiles.add(h.source.file);
                            }
                        }

                        for (const s of sales) {
                            if (s.source?.file) {
                                sourceFiles.add(s.source.file);
                            }
                        }

                        for (const d of dividends) {
                            if (d.source?.file) {
                                sourceFiles.add(d.source.file);
                            }
                        }

                        for (const sy of stockYield) {
                            if (sy.source?.file) {
                                sourceFiles.add(sy.source.file);
                            }
                        }

                        for (const bi of brokerInterest) {
                            for (const e of bi.entries) {
                                if (e.source?.file) {
                                    sourceFiles.add(e.source.file);
                                }
                            }
                        }

                        return (
                            <div
                                style={{
                                    marginBottom: '1.5rem',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '6px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    fontSize: '0.9rem',
                                }}
                            >
                                <strong>{t('import.currentData')}:</strong>
                                <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)' }}>
                                    {[
                                        holdings.length > 0 && `${holdings.length} ${t('tab.holdings').toLowerCase()}`,
                                        sales.length > 0 && `${sales.length} ${t('tab.sales').toLowerCase()}`,
                                        dividends.length > 0 && `${dividends.length} ${t('tab.dividends').toLowerCase()}`,
                                        stockYield.length > 0 && `${stockYield.length} ${t('tab.stockYield').toLowerCase()}`,
                                        brokerInterest.length > 0 && `${brokerInterest.reduce((s, bi) => s + bi.entries.length, 0)} ${t('tab.interest').toLowerCase()}`,
                                    ].filter(Boolean).join(', ')}
                                </span>
                                {sourceFiles.size > 0 && (
                                    <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                        {t('import.sourceFiles')}: {Array.from(sourceFiles).join(', ')}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Imported files list */}
                    {importedFiles.length > 0 && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h3 style={{ marginBottom: '0.5rem' }}>{t('import.importedFiles')}</h3>
                            {importedFiles.map((f, i) => (
                                <div
                                    key={i}
                                    style={{
                                        padding: '0.75rem 1rem',
                                        marginBottom: '0.5rem',
                                        borderRadius: '6px',
                                        backgroundColor: f.status === 'success' ? 'var(--success-bg)' : 'var(--error-bg)',
                                        border: `1px solid ${f.status === 'success' ? 'var(--success-border)' : 'var(--error-border)'}`,
                                    }}
                                >
                                    <div style={{ fontWeight: 'bold' }}>
                                        {f.status === 'success' ? '✅' : '❌'} {f.name}
                                        <span
                                            style={{
                                                marginLeft: '0.5rem',
                                                fontSize: '0.8rem',
                                                backgroundColor: f.type === 'ib'
                                                    ? 'var(--accent)'
                                                    : f.type === 'revolut-investments'
                                                    ? '#6f42c1'
                                                    : f.type === 'etrade'
                                                    ? '#ff6b35'
                                                    : '#28a745',
                                                color: 'white',
                                                padding: '0.1rem 0.4rem',
                                                borderRadius: '3px',
                                            }}
                                        >
                                            {f.type === 'ib' ? 'IB' : f.type === 'revolut-investments' ? 'Revolut Inv.' : f.type === 'etrade' ? 'E*TRADE' : 'Revolut'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                        {f.message}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Revolut Savings balance prompt */}
                    {pendingSavingsBalances.length > 0 && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h3 style={{ marginBottom: '0.5rem' }}>{t('import.savingsBalanceTitle')}</h3>
                            {pendingSavingsBalances.map((sb, idx) => (
                                <div
                                    key={idx}
                                    style={{
                                        padding: '1rem',
                                        marginBottom: '0.5rem',
                                        borderRadius: '6px',
                                        backgroundColor: 'var(--bg-secondary)',
                                        border: '1px solid var(--accent)',
                                    }}
                                >
                                    <div style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
                                        Revolut Savings — {sb.currency}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                                        {t('import.savingsBalanceHint')}
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', alignItems: 'center' }}>
                                            ISIN:
                                            <input
                                                type='text'
                                                value={sb.isin}
                                                onChange={(e) => {
                                                    const updated = [...pendingSavingsBalances];
                                                    updated[idx] = { ...sb, isin: e.target.value.toUpperCase() };
                                                    setPendingSavingsBalances(updated);
                                                }}
                                                style={{ marginLeft: '0.5rem', width: '160px', padding: '0.3rem', fontFamily: 'monospace' }}
                                                placeholder='e.g. IE0002RUHW32'
                                            />
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center' }}>
                                            {t('import.openingBalance')}:
                                            <input
                                                type='number'
                                                step='0.01'
                                                value={sb.openingBalance}
                                                onChange={(e) => {
                                                    const updated = [...pendingSavingsBalances];
                                                    updated[idx] = { ...sb, openingBalance: e.target.value };
                                                    setPendingSavingsBalances(updated);
                                                }}
                                                style={{ marginLeft: '0.5rem', width: '120px', padding: '0.3rem' }}
                                                placeholder='0.00'
                                            />
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center' }}>
                                            {t('import.closingBalance')}:
                                            <input
                                                type='number'
                                                step='0.01'
                                                value={sb.closingBalance}
                                                onChange={(e) => {
                                                    const updated = [...pendingSavingsBalances];
                                                    updated[idx] = { ...sb, closingBalance: e.target.value };
                                                    setPendingSavingsBalances(updated);
                                                }}
                                                style={{ marginLeft: '0.5rem', width: '120px', padding: '0.3rem' }}
                                            />
                                        </label>
                                        <button
                                            onClick={() => {
                                                // Store as SPB-8 Section 04 security (Ценни книжа)
                                                const opening = parseFloat(sb.openingBalance) || 0;
                                                const closing = parseFloat(sb.closingBalance) || sb.quantityEndOfYear;

                                                if (sb.isin) {
                                                    const currentSecurities = useAppStore.getState().savingsSecurities ?? [];
                                                    const filteredSec = currentSecurities.filter(
                                                        s => !(s.isin === sb.isin && s.currency === sb.currency),
                                                    );
                                                    setSavingsSecurities([...filteredSec, {
                                                        isin: sb.isin,
                                                        currency: sb.currency,
                                                        quantityStartOfYear: opening,
                                                        quantityEndOfYear: closing,
                                                    }]);
                                                }

                                                // Remove this prompt
                                                setPendingSavingsBalances(prev => prev.filter((_, i) => i !== idx));
                                            }}
                                            style={{
                                                padding: '0.4rem 1rem',
                                                backgroundColor: 'var(--accent)',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                            }}
                                        >
                                            {t('button.save')}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Foreign bank accounts section */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ marginBottom: '0.5rem' }}>{t('import.foreignAccountsTitle')}</h3>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                            {t('import.foreignAccountsHint')}
                        </div>

                        {/* Existing foreign accounts from previous imports */}
                        {(foreignAccounts ?? []).map((acc, idx) => (
                            <div
                                key={`existing-${idx}`}
                                style={{
                                    display: 'flex',
                                    gap: '0.75rem',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    padding: '0.75rem',
                                    marginBottom: '0.5rem',
                                    borderRadius: '6px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                }}
                            >
                                <span style={{ fontWeight: 'bold', minWidth: '120px' }}>{acc.broker}</span>
                                <span style={{ fontFamily: 'monospace' }}>{acc.currency}</span>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {t('import.openingBalance')}: {acc.amountStartOfYear.toFixed(2)}
                                </span>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {t('import.closingBalance')}: {acc.amountEndOfYear.toFixed(2)}
                                </span>
                                <button
                                    onClick={() => {
                                        const updated = (foreignAccounts ?? []).filter((_, i) => i !== idx);
                                        setForeignAccounts(updated);
                                    }}
                                    style={{
                                        padding: '0.2rem 0.5rem',
                                        backgroundColor: '#e74c3c',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                    }}
                                >
                                    {t('button.delete')}
                                </button>
                            </div>
                        ))}

                        {/* Pending new accounts being entered */}
                        {bankAccounts.map((acc, idx) => (
                            <div
                                key={`new-${idx}`}
                                style={{
                                    display: 'flex',
                                    gap: '0.75rem',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    padding: '0.75rem',
                                    marginBottom: '0.5rem',
                                    borderRadius: '6px',
                                    backgroundColor: 'var(--bg-secondary)',
                                    border: '1px solid var(--accent)',
                                }}
                            >
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {t('import.broker')}:
                                    <select
                                        value={importedBrokers.includes(acc.broker) ? acc.broker : '__custom__'}
                                        onChange={(e) => {
                                            const updated = [...bankAccounts];
                                            updated[idx] = { ...acc, broker: e.target.value === '__custom__' ? '' : e.target.value };
                                            setBankAccounts(updated);
                                        }}
                                        style={{ padding: '0.3rem', minWidth: '120px' }}
                                    >
                                        <option value=''>--</option>
                                        {importedBrokers.map(b => <option key={b} value={b}>{b}</option>)}
                                        <option value='__custom__'>{t('import.customBroker')}</option>
                                    </select>
                                    {!importedBrokers.includes(acc.broker) && acc.broker !== '' && (
                                        <input
                                            type='text'
                                            value={acc.broker}
                                            onChange={(e) => {
                                                const updated = [...bankAccounts];
                                                updated[idx] = { ...acc, broker: e.target.value };
                                                setBankAccounts(updated);
                                            }}
                                            style={{ padding: '0.3rem', width: '120px' }}
                                            placeholder='Broker name'
                                        />
                                    )}
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {t('import.currency')}:
                                    <select
                                        value={acc.currency}
                                        onChange={(e) => {
                                            const updated = [...bankAccounts];
                                            updated[idx] = { ...acc, currency: e.target.value };
                                            setBankAccounts(updated);
                                            // Trigger FX fetch for new currency
                                            const ccy = e.target.value;
                                            if (ccy && ccy !== 'EUR' && ccy !== 'BGN') {
                                                const state = useAppStore.getState();
                                                const yearEnd = `${taxYear}-12-31`;
                                                if (!state.fxRates[ccy]?.[yearEnd]) {
                                                    const fxService = new FxService(new InMemoryFxCache(), baseCurrency);
                                                    void fxService.fetchRates([ccy], taxYear).then(rates => {
                                                        useAppStore.getState().setFxRates(rates);
                                                    });
                                                }
                                            }
                                        }}
                                        style={{ padding: '0.3rem', minWidth: '80px' }}
                                    >
                                        <option value=''>--</option>
                                        {availableCurrencies.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {t('import.openingBalance')}:
                                    <input
                                        type='number'
                                        step='0.01'
                                        value={acc.openingBalance}
                                        onChange={(e) => {
                                            const updated = [...bankAccounts];
                                            updated[idx] = { ...acc, openingBalance: e.target.value };
                                            setBankAccounts(updated);
                                        }}
                                        style={{ width: '120px', padding: '0.3rem' }}
                                        placeholder='0.00'
                                    />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                    {t('import.closingBalance')}:
                                    <input
                                        type='number'
                                        step='0.01'
                                        value={acc.closingBalance}
                                        onChange={(e) => {
                                            const updated = [...bankAccounts];
                                            updated[idx] = { ...acc, closingBalance: e.target.value };
                                            setBankAccounts(updated);
                                        }}
                                        style={{ width: '120px', padding: '0.3rem' }}
                                    />
                                </label>
                                <button
                                    onClick={() => {
                                        // Save this account
                                        if (acc.broker && acc.currency) {
                                            const opening = parseFloat(acc.openingBalance) || 0;
                                            const closing = parseFloat(acc.closingBalance) || 0;
                                            const current = useAppStore.getState().foreignAccounts ?? [];
                                            setForeignAccounts([...current, {
                                                broker: acc.broker,
                                                type: '01' as const,
                                                maturity: 'L' as const,
                                                country: 'IE',
                                                currency: acc.currency,
                                                amountStartOfYear: opening,
                                                amountEndOfYear: closing,
                                            }]);
                                            setBankAccounts(prev => prev.filter((_, i) => i !== idx));
                                        }
                                    }}
                                    disabled={!acc.broker || !acc.currency}
                                    style={{
                                        padding: '0.3rem 0.75rem',
                                        backgroundColor: acc.broker && acc.currency ? 'var(--accent)' : 'var(--border)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: acc.broker && acc.currency ? 'pointer' : 'not-allowed',
                                    }}
                                >
                                    {t('button.save')}
                                </button>
                                <button
                                    onClick={() => setBankAccounts(prev => prev.filter((_, i) => i !== idx))}
                                    style={{
                                        padding: '0.2rem 0.5rem',
                                        backgroundColor: '#e74c3c',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem',
                                    }}
                                >
                                    {t('button.delete')}
                                </button>
                            </div>
                        ))}

                        <button
                            onClick={() => setBankAccounts(prev => [...prev, { broker: '', currency: '', openingBalance: '', closingBalance: '' }])}
                            style={{
                                padding: '0.4rem 1rem',
                                backgroundColor: 'var(--bg-secondary)',
                                color: 'var(--text-primary)',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            + {t('import.addAccount')}
                        </button>
                    </div>

                    <button
                        disabled={!!fxProgress?.active || pendingSavingsBalances.length > 0}
                        onClick={() => navigate('/workspace')}
                        style={{
                            padding: '0.75rem 2rem',
                            fontSize: '1rem',
                            backgroundColor: importedFiles.some(f => f.status === 'success') && pendingSavingsBalances.length === 0 ? 'var(--accent)' : 'var(--border)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: pendingSavingsBalances.length > 0 || fxProgress?.active ? 'not-allowed' : 'pointer',
                            opacity: fxProgress?.active || pendingSavingsBalances.length > 0 ? 0.7 : 1,
                        }}
                    >
                        {fxProgress?.active ? t('import.fetchingFx') : t('button.continue')}
                    </button>
                </div>

                {/* Right column: instructions */}
                <div
                    style={{
                        padding: '1.25rem',
                        backgroundColor: 'var(--bg-secondary)',
                        borderRadius: '8px',
                        fontSize: '0.9rem',
                        lineHeight: '1.6',
                    }}
                >
                    <h3 style={{ marginBottom: '0.75rem' }}>{t('import.howTo')}</h3>
                    {providers.map(p =>
                        p.exportInstructions.map(instr => (
                            <div key={instr.label} style={{ marginBottom: '0.75rem' }}>
                                <strong>{t(instr.label)}:</strong>
                                <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                                    {instr.steps.map(step => <li key={step}>{t(step)}</li>)}
                                </ol>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
