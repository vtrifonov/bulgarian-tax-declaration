/**
 * Fills gaps in daily FX rates by carrying forward the last known rate.
 * Used to handle weekends and holidays when ECB doesn't publish rates.
 */
export function gapFillRates(
    rates: Record<string, number>,
    startDate: string,
    endDate: string,
): Record<string, number> {
    const result = { ...rates };
    const current = new Date(startDate);
    const end = new Date(endDate);
    let lastRate: number | null = null;

    while (current <= end) {
        const dateStr = formatDate(current);
        if (dateStr in rates) {
            lastRate = rates[dateStr];
            result[dateStr] = lastRate;
        } else if (lastRate !== null) {
            result[dateStr] = lastRate;
        }
        current.setDate(current.getDate() + 1);
    }

    return result;
}

function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
