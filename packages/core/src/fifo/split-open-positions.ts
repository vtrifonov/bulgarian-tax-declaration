import type {
    Holding,
    IBOpenPosition,
    Trade,
} from '../types/index.js';

const randomUUID = () => crypto.randomUUID();

export interface SplitOpenPositionsOpts {
    broker: string;
    countryMap: Record<string, string>;
    source?: { type: string; file: string };
    taxYear: number;
    symbolAliases: Record<string, string>;
    skipPreExisting?: boolean;
    /** When skipPreExisting is true, existing holdings to check against.
     *  Pre-existing positions are only skipped if a matching symbol+broker already exists here.
     *  Positions for symbols NOT in this list are still added (new symbols from the provider). */
    existingHoldings?: { symbol: string; broker: string }[];
}

/**
 * Split IB Open Positions into individual lots using this year's trade data.
 *
 * For each open position, determines how much is pre-existing vs. bought this year,
 * accounting for sells that consume lots in FIFO order (oldest first).
 */
export function splitOpenPositions(
    openPositions: IBOpenPosition[],
    trades: Trade[],
    opts: SplitOpenPositionsOpts,
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

        // Pre-existing lot (bought before this year)
        // Skip if prior-year holdings already cover this symbol+broker.
        // But if this symbol is NEW (not in existing holdings for this broker), add it even when skipPreExisting is true.
        // When existingHoldings is provided, do per-symbol check.
        // When not provided, fall back to old behavior (skip all when skipPreExisting=true).
        const symbolAlreadyExists = opts.existingHoldings
            ? opts.existingHoldings.some(h => h.symbol === pos.symbol && h.broker === opts.broker)
            : true; // no list provided → assume all exist (backward compat)
        const shouldAddPreExisting = !opts.skipPreExisting || !symbolAlreadyExists;

        if (preExistingQty > 0 && shouldAddPreExisting) {
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
                id: randomUUID(),
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
                    id: randomUUID(),
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
