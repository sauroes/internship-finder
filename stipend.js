/**
 * Turns stipend text such as "₹ 10,000 - 20,000 /month" into numbers.
 * Everything is converted to INR per month. Lump-sum, unpaid and
 * performance-based listings get no monthly figure.
 */
export function parseStipend(rawText) {
    const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const empty = { minMonthly: null, maxMonthly: null, kind: 'unknown' };

    if (!text) return empty;
    if (/\bunpaid\b/.test(lower)) return { ...empty, kind: 'unpaid' };
    if (/lump\s*sum/.test(lower)) return { ...empty, kind: 'lump_sum' };

    // Only the first amount or range counts, so "+ 10% share" is ignored.
    const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?(?:\s*(?:-|–|to)\s*₹?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?)?/i);
    if (!match) return lower.includes('performance') ? { ...empty, kind: 'performance' } : empty;

    const toNumber = (digits, k) => {
        if (!digits) return null;
        const n = Number(digits.replace(/,/g, ''));
        return k ? n * 1000 : n;
    };
    let low = toNumber(match[1], match[2]);
    let high = match[3] ? toNumber(match[3], match[4] ?? match[2]) : low;
    if (low === null || Number.isNaN(low)) return empty;
    if (high === null || Number.isNaN(high)) high = low;
    if (high < low) [low, high] = [high, low];

    let factor = 1;
    if (/\/\s*week|per week|weekly/.test(lower)) factor = 4;
    else if (/\/\s*year|per year|per annum|p\.a|lpa|yearly|annum/.test(lower)) factor = 1 / 12;

    return {
        minMonthly: Math.round(low * factor),
        maxMonthly: Math.round(high * factor),
        kind: low === high ? 'fixed' : 'range',
    };
}
