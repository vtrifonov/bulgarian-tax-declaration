import type {
    Holding,
    Sale,
    Trade,
    ValidationWarning,
} from '../types/index.js';
const randomUUID = () => crypto.randomUUID();

export interface FifoResult {
    holdings: Holding[];
    consumedHoldings: Holding[];
    sales: Sale[];
    warnings: ValidationWarning[];
}

export class FifoEngine {
    private lots: Map<string, Holding[]>; // symbol → sorted lots (oldest first)

    constructor(existingHoldings: Holding[]) {
        this.lots = new Map();

        for (const h of existingHoldings) {
            const list = this.lots.get(h.symbol) ?? [];

            list.push({ ...h });
            this.lots.set(h.symbol, list);
        }

        // Sort each symbol's lots by dateAcquired
        for (const [, list] of this.lots) {
            list.sort((a, b) => a.dateAcquired.localeCompare(b.dateAcquired));
        }
    }

    processTrades(
        trades: Trade[],
        broker: string,
        countryMap: Record<string, string>,
    ): FifoResult {
        const sales: Sale[] = [];
        const warnings: ValidationWarning[] = [];
        const consumedHoldings: Holding[] = [];

        // Sort trades by datetime ascending
        const sorted = [...trades].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

        for (const trade of sorted) {
            if (trade.quantity > 0) {
                this.addLot(trade, broker, countryMap);
            } else if (trade.quantity < 0) {
                const result = this.sellLots(trade, broker, countryMap);

                sales.push(...result.sales);
                warnings.push(...result.warnings);
                consumedHoldings.push(...result.consumed);
            }
        }

        // Flatten remaining lots into holdings array
        const holdings: Holding[] = [];

        for (const [, list] of this.lots) {
            holdings.push(...list.filter(h => h.quantity > 0));
        }

        return { holdings, consumedHoldings, sales, warnings };
    }

    private addLot(trade: Trade, broker: string, countryMap: Record<string, string>): void {
        const date = trade.dateTime.split(',')[0].trim();
        const lot: Holding = {
            id: randomUUID(),
            broker,
            country: countryMap[trade.symbol] ?? '',
            symbol: trade.symbol,
            dateAcquired: date,
            quantity: trade.quantity,
            currency: trade.currency,
            unitPrice: trade.price,
        };
        const list = this.lots.get(trade.symbol) ?? [];

        list.push(lot);
        this.lots.set(trade.symbol, list);
    }

    private sellLots(
        trade: Trade,
        broker: string,
        countryMap: Record<string, string>,
    ): { sales: Sale[]; warnings: ValidationWarning[]; consumed: Holding[] } {
        const sales: Sale[] = [];
        const warnings: ValidationWarning[] = [];
        const consumed: Holding[] = [];
        let remaining = Math.abs(trade.quantity);
        const dateSold = trade.dateTime.split(',')[0].trim();
        const lots = this.lots.get(trade.symbol) ?? [];

        // Per-share cost basis from the sell trade (IB provides total basis)
        const basisPerShare = trade.basis !== undefined && trade.basis !== null
            ? Math.abs(trade.basis) / Math.abs(trade.quantity)
            : 0;

        while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const consumedQty = Math.min(lot.quantity, remaining);

            // Use lot price if available, fall back to trade's basis (e.g. for transfers with no price)
            const buyPrice = lot.unitPrice > 0 ? lot.unitPrice : basisPerShare;

            const saleId = randomUUID();

            sales.push({
                id: saleId,
                broker,
                country: countryMap[trade.symbol] ?? '',
                symbol: trade.symbol,
                dateAcquired: lot.dateAcquired,
                dateSold,
                quantity: consumedQty,
                currency: trade.currency,
                buyPrice,
                sellPrice: trade.price,
                fxRateBuy: null, // Filled later by FX service
                fxRateSell: null,
            });

            // Track which sales consumed this lot
            lot.consumedBySaleIds ??= [];
            lot.consumedBySaleIds.push(saleId);

            lot.quantity -= consumedQty;
            remaining -= consumedQty;

            if (lot.quantity <= 0) {
                lot.consumedByFifo = true;
                consumed.push(lots.shift() as Holding);
            }
        }

        if (remaining > 0) {
            // Create sale with empty buy data — user can fill in manually
            sales.push({
                id: randomUUID(),
                broker,
                country: countryMap[trade.symbol] ?? '',
                symbol: trade.symbol,
                dateAcquired: '',
                dateSold,
                quantity: remaining,
                currency: trade.currency,
                buyPrice: basisPerShare,
                sellPrice: trade.price,
                fxRateBuy: null,
                fxRateSell: null,
            });
            warnings.push({
                type: 'negative-holdings',
                message: `Sell of ${Math.abs(trade.quantity)} ${trade.symbol}: ${remaining} shares have no matching buy — fill in acquisition date and price manually`,
                tab: 'Sales',
            });
        }

        return { sales, warnings, consumed };
    }
}
