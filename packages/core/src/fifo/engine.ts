import type {
    Holding,
    IBTrade,
    Sale,
    ValidationWarning,
} from '../types/index.js';
const randomUUID = () => crypto.randomUUID();

export interface FifoResult {
    holdings: Holding[];
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
        trades: IBTrade[],
        broker: string,
        countryMap: Record<string, string>,
    ): FifoResult {
        const sales: Sale[] = [];
        const warnings: ValidationWarning[] = [];

        // Sort trades by datetime ascending
        const sorted = [...trades].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

        for (const trade of sorted) {
            if (trade.quantity > 0) {
                this.addLot(trade, broker, countryMap);
            } else if (trade.quantity < 0) {
                const result = this.sellLots(trade, broker, countryMap);
                sales.push(...result.sales);
                warnings.push(...result.warnings);
            }
        }

        // Flatten remaining lots into holdings array
        const holdings: Holding[] = [];
        for (const [, list] of this.lots) {
            holdings.push(...list.filter(h => h.quantity > 0));
        }

        return { holdings, sales, warnings };
    }

    private addLot(trade: IBTrade, broker: string, countryMap: Record<string, string>): void {
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
        trade: IBTrade,
        broker: string,
        countryMap: Record<string, string>,
    ): { sales: Sale[]; warnings: ValidationWarning[] } {
        const sales: Sale[] = [];
        const warnings: ValidationWarning[] = [];
        let remaining = Math.abs(trade.quantity);
        const dateSold = trade.dateTime.split(',')[0].trim();
        const lots = this.lots.get(trade.symbol) ?? [];

        while (remaining > 0 && lots.length > 0) {
            const lot = lots[0];
            const consumed = Math.min(lot.quantity, remaining);

            sales.push({
                id: randomUUID(),
                broker,
                country: countryMap[trade.symbol] ?? '',
                symbol: trade.symbol,
                dateAcquired: lot.dateAcquired,
                dateSold,
                quantity: consumed,
                currency: trade.currency,
                buyPrice: lot.unitPrice,
                sellPrice: trade.price,
                fxRateBuy: 0, // Filled later by FX service
                fxRateSell: 0,
            });

            lot.quantity -= consumed;
            remaining -= consumed;

            if (lot.quantity <= 0) {
                lots.shift();
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
                buyPrice: 0,
                sellPrice: trade.price,
                fxRateBuy: 0,
                fxRateSell: 0,
            });
            warnings.push({
                type: 'negative-holdings',
                message: `Sell of ${Math.abs(trade.quantity)} ${trade.symbol}: ${remaining} shares have no matching buy — fill in acquisition date and price manually`,
                tab: 'Sales',
            });
        }

        return { sales, warnings };
    }
}
