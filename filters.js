/**
 * Decides which collected listings to keep.
 */
export function applyFilters(listings, options) {
    const {
        minStipendPerMonth = 0,
        matchOn = 'min',
        includeUnknownStipend = false,
        excludeTitleKeywords = [],
        maxResults = 100,
    } = options;

    const banned = excludeTitleKeywords.map((w) => String(w).toLowerCase().trim()).filter(Boolean);
    const stats = { collected: listings.length, notRemote: 0, excludedTitle: 0, noStipend: 0, belowMinimum: 0 };
    const kept = [];

    for (const item of listings) {
        if (!item.isRemote) { stats.notRemote++; continue; }

        const title = String(item.title ?? '').toLowerCase();
        if (banned.some((word) => title.includes(word))) { stats.excludedTitle++; continue; }

        const comparison = matchOn === 'max' ? item.stipendMaxMonthly : item.stipendMinMonthly;
        if (comparison === null || comparison === undefined) {
            if (includeUnknownStipend) kept.push(item);
            else stats.noStipend++;
            continue;
        }
        if (comparison < minStipendPerMonth) { stats.belowMinimum++; continue; }
        kept.push(item);
    }

    kept.sort((a, b) => (b.stipendMinMonthly ?? 0) - (a.stipendMinMonthly ?? 0)
        || (b.stipendMaxMonthly ?? 0) - (a.stipendMaxMonthly ?? 0));

    stats.kept = Math.min(kept.length, maxResults);
    return { items: kept.slice(0, maxResults), stats };
}
