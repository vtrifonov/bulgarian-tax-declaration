import {
    calcDividendTax,
    FifoEngine,
    FxService,
    InMemoryFxCache,
    matchWhtToDividends,
    parseIBCsv,
    parseRevolutCsv,
    parseRevolutInvestmentsCsv,
    populateSaleFxRates,
    providers,
    resolveCountries,
    t,
} from '@bg-tax/core';
import type {
    BrokerInterest,
    Holding,
    IBParsedData,
    Trade,
} from '@bg-tax/core';
import {
    useCallback,
    useEffect,
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

function detectFileType(content: string, filename: string): ImportedFile['type'] | null {
    // IB Activity statement
    if (content.startsWith('Statement,Header,Field Name') || content.includes('Trades,Header,DataDiscriminator')) {
        return 'ib';
    }

    // Revolut Savings interest statement
    if (filename.startsWith('savings-statement') || content.includes('Interest PAID')) {
        return 'revolut';
    }

    // Revolut Investments yearly statement
    if (content.startsWith('Date,Ticker,Type')) {
        return 'revolut-investments';
    }

    return null;
}

/**
 * Split Open Positions into pre-existing lots + this year's individual buy lots.
 * For each symbol: if trades show buys this year, subtract them from the open position
 * to get the pre-existing portion. Each buy this year becomes its own holding with date.
 */
function splitOpenPositions(
    openPositions: IBParsedData['openPositions'],
    trades: Trade[],
    opts: {
        broker: string;
        countryMap: Record<string, string>;
        source: { type: string; file: string };
        taxYear: number;
        symbolAliases: Record<string, string>;
        skipPreExisting?: boolean;
    },
): Holding[] {
    const holdings: Holding[] = [];
    const yearPrefix = String(opts.taxYear);

    // Helper to resolve symbol through alias map
    const resolveSymbol = (sym: string) => opts.symbolAliases[sym] ?? sym;

    // Group this year's trades (buys and sells) by resolved symbol
    const buysBySymbol = new Map<string, Trade[]>();
    const sellQtyBySymbol = new Map<string, number>();

    for (const t of trades) {
        if (!t.dateTime.startsWith(yearPrefix)) {
            continue;
        }

        const sym = resolveSymbol(t.symbol);

        if (t.quantity > 0) {
            const buys = buysBySymbol.get(sym) ?? [];

            buys.push(t);
            buysBySymbol.set(sym, buys);
        } else {
            const current = sellQtyBySymbol.get(sym) ?? 0;

            sellQtyBySymbol.set(sym, current + Math.abs(t.quantity));
        }
    }

    for (const pos of openPositions) {
        const buys = buysBySymbol.get(pos.symbol) ?? [];
        const sellQty = sellQtyBySymbol.get(pos.symbol) ?? 0;

        // Total bought this year (gross, before accounting for sells)
        const totalBoughtThisYear = buys.reduce((sum, t) => sum + t.quantity, 0);
        // Net buys remaining after sells (FIFO: sells consume oldest first, which are pre-existing)
        // But from Open Positions perspective: we know the final quantity.
        // Sells consume pre-existing lots first (FIFO), then this year's buys
        const preExistingBeforeSells = pos.quantity + sellQty - totalBoughtThisYear;
        const sellsFromPreExisting = Math.min(sellQty, Math.max(0, preExistingBeforeSells));
        const sellsFromThisYear = sellQty - sellsFromPreExisting;
        const survivedThisYearQty = totalBoughtThisYear - sellsFromThisYear;
        const preExistingQty = pos.quantity - survivedThisYearQty;

        // Pre-existing lot (bought before this year) — skip if prior-year holdings already imported
        if (preExistingQty > 0 && !opts.skipPreExisting) {
            // Back-calculate cost: IB's costPrice is weighted average of ALL remaining shares.
            // Subtract only the cost of SURVIVING this-year buys to get pre-existing cost.
            const sortedBuysForCost = [...buys].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
            let remainingSellsForCost = sellsFromThisYear;
            let survivedThisYearCost = 0;

            for (const buy of sortedBuysForCost) {
                if (remainingSellsForCost >= buy.quantity) {
                    remainingSellsForCost -= buy.quantity;
                    continue;
                }
                const survived = buy.quantity - remainingSellsForCost;

                remainingSellsForCost = 0;
                survivedThisYearCost += survived * buy.price;
            }
            const preExistingTotalCost = pos.costPrice * pos.quantity - survivedThisYearCost;
            const preExistingUnitPrice = preExistingTotalCost / preExistingQty;

            holdings.push({
                id: crypto.randomUUID(),
                broker: opts.broker,
                country: opts.countryMap[pos.symbol] ?? '',
                symbol: pos.symbol,
                dateAcquired: '',
                quantity: preExistingQty,
                currency: pos.currency,
                unitPrice: Math.max(0, preExistingUnitPrice),
                source: opts.source,
            });
        }

        // This year's individual buy lots (only those that survived sells)
        if (survivedThisYearQty > 0 && buys.length > 0) {
            // FIFO: sells consume earliest buys first — so surviving buys are the latest ones
            const sortedBuys = [...buys].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
            let remainingSellQty = sellsFromThisYear;

            for (const buy of sortedBuys) {
                if (remainingSellQty >= buy.quantity) {
                    remainingSellQty -= buy.quantity;
                    continue; // fully consumed by sell
                }
                const survivedQty = buy.quantity - remainingSellQty;

                remainingSellQty = 0;

                holdings.push({
                    id: crypto.randomUUID(),
                    broker: opts.broker,
                    country: opts.countryMap[buy.symbol] ?? '',
                    symbol: buy.symbol,
                    dateAcquired: buy.dateTime.split(',')[0], // "YYYY-MM-DD, HH:MM:SS" → "YYYY-MM-DD"
                    quantity: survivedQty,
                    currency: pos.currency,
                    unitPrice: buy.price,
                    source: opts.source,
                });
            }
        }

        // Note: the preExistingQty block above already handles the case
        // where buys.length === 0 && sellQty === 0 (entire position is pre-existing)
    }

    return holdings;
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
    } = useAppStore();

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

    const processFile = useCallback(async (file: File) => {
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
                const fifo = new FifoEngine([...useAppStore.getState().holdings]);
                const { holdings: fifoHoldings, consumedHoldings: fifoConsumed, sales: newSales, warnings } = fifo.processTrades(parsed.trades, 'IB', countryMap);

                for (const s of newSales) {
                    if (!s.source) {
                        s.source = { type: 'IB', file: file.name };
                    }
                }
                importSales(newSales);

                // Use Open Positions as authoritative year-end holdings (if available)
                // If prior-year holdings exist, only add this year's buy lots (skip pre-existing)
                const hasPriorHoldings = useAppStore.getState().holdings.some(h => h.source?.type !== 'IB');
                let finalHoldings: Holding[];

                if (parsed.openPositions.length > 0) {
                    finalHoldings = splitOpenPositions(parsed.openPositions, parsed.trades, {
                        broker: 'IB',
                        countryMap,
                        source: { type: 'IB', file: file.name },
                        taxYear,
                        symbolAliases: parsed.symbolAliases,
                        skipPreExisting: hasPriorHoldings,
                    });
                } else {
                    finalHoldings = fifoHoldings;

                    for (const h of finalHoldings) {
                        if (!h.source) {
                            h.source = { type: 'IB', file: file.name };
                        }
                    }
                }
                // Merge: keep non-IB holdings (with symbol + country normalization), replace IB holdings
                const existingNonIb = useAppStore.getState().holdings.filter(h => h.source?.type !== 'IB');

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
                // Include consumed holdings (marked by FIFO engine) so user can see what was matched
                const consumedIds = new Set(fifoConsumed.map(h => h.id));
                const remainingNonIb = existingNonIb.filter(h => !consumedIds.has(h.id));

                importHoldings([...remainingNonIb, ...fifoConsumed, ...finalHoldings]);

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

                const fifo = new FifoEngine([...useAppStore.getState().holdings]);
                const { holdings: newHoldings, consumedHoldings: revConsumed, sales: newSales, warnings } = fifo.processTrades(fifoTrades, 'Revolut', countryMap);

                for (const h of newHoldings) {
                    if (!h.source) {
                        h.source = { type: 'Revolut', file: file.name };
                    }
                }

                for (const s of newSales) {
                    if (!s.source) {
                        s.source = { type: 'Revolut', file: file.name };
                    }
                }
                // FifoEngine flattens holdings by symbol (Map), losing original order.
                // Preserve original order: use current state's array, swap in FIFO-updated
                // versions (which may have reduced quantities from sells).
                // Insert Revolut holdings after non-broker originals but before broker holdings.
                const currentHoldings = useAppStore.getState().holdings;
                const existingIds = new Set(currentHoldings.map(h => h.id));
                const consumedIds = new Set(revConsumed.map(h => h.id));
                const updatedById = new Map(
                    newHoldings.filter(h => existingIds.has(h.id)).map(h => [h.id, h]),
                );
                const survivingOriginals = currentHoldings
                    .filter(h => !consumedIds.has(h.id))
                    .map(h => updatedById.get(h.id) ?? h);
                const newRevolutHoldings = newHoldings.filter(h => !existingIds.has(h.id));
                importHoldings([...survivingOriginals, ...revConsumed, ...newRevolutHoldings]);

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
                    message: `${buys} buys, ${sells} sells → ${newSales.length} matched sales, ${newHoldings.length} remaining holdings${warnMsg}`,
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
            }
        } catch (err) {
            addImportedFile({
                name: file.name,
                type: fileType,
                status: 'error',
                message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
    }, [importHoldings, importSales, importDividends, importStockYield, importBrokerInterest, addImportedFile, taxYear]);

    const processFiles = useCallback((files: FileList | File[]) => {
        Array.from(files).forEach(file => {
            if (file.name.endsWith('.csv')) {
                void processFile(file);
            } else {
                addImportedFile({
                    name: file.name,
                    type: 'ib',
                    status: 'error',
                    message: 'Only .csv files are supported',
                });
            }
        });
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
                            accept='.csv'
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
                                                backgroundColor: f.type === 'ib' ? 'var(--accent)' : f.type === 'revolut-investments' ? '#6f42c1' : '#28a745',
                                                color: 'white',
                                                padding: '0.1rem 0.4rem',
                                                borderRadius: '3px',
                                            }}
                                        >
                                            {f.type === 'ib' ? 'IB' : f.type === 'revolut-investments' ? 'Revolut Inv.' : 'Revolut'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                        {f.message}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        disabled={!!fxProgress?.active}
                        onClick={() => navigate('/workspace')}
                        style={{
                            padding: '0.75rem 2rem',
                            fontSize: '1rem',
                            backgroundColor: importedFiles.some(f => f.status === 'success') ? 'var(--accent)' : 'var(--border)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            opacity: fxProgress?.active ? 0.7 : 1,
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
