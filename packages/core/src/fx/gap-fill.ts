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

    // Seed lastRate from the most recent rate before startDate (e.g. Dec 31 for Jan 1 gap)
    let lastRate: number | null = null;
    const sortedDates = Object.keys(rates).sort();

    for (const d of sortedDates) {
        if (d < startDate) {
            lastRate = rates[d];
        } else {
            break;
        }
    }

    // If no rate before startDate, use the first rate in the range as back-fill seed
    if (lastRate === null) {
        const firstInRange = sortedDates.find(d => d >= startDate && d <= endDate);

        if (firstInRange) {
            lastRate = rates[firstInRange];
        }
    }

    while (current <= end) {
        const dateStr = formatDate(current);

        if (dateStr in rates) {
            lastRate = rates[dateStr];
        }

        if (lastRate !== null) {
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
