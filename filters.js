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
        remoteOnly = true,
        includeUnknownStipendWeb = true,
    } = options;

    const banned = excludeTitleKeywords.map((w) => String(w).toLowerCase().trim()).filter(Boolean);
    const stats = { collected: listings.length, notRemote: 0, excludedTitle: 0, noStipend: 0, belowMinimum: 0 };
    const kept = [];

    for (const item of listings) {
        if (remoteOnly && !item.isRemote) { stats.notRemote++; continue; }

        const title = String(item.title ?? '').toLowerCase();
        if (banned.some((word) => title.includes(word))) { stats.excludedTitle++; continue; }

        const comparison = matchOn === 'max' ? item.stipendMaxMonthly : item.stipendMinMonthly;
        if (comparison === null || comparison === undefined) {
            // Official pages often omit the stipend, so web results get their own switch.
            if (includeUnknownStipend || (item.source === 'web' && includeUnknownStipendWeb)) kept.push(item);
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

const slug = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Collapses the same role found on several sites. Official (web) pages win over
 * Internshala, and a record with a stipend wins over one without.
 */
export function dedupe(listings) {
    const best = new Map();
    for (const item of listings) {
        const key = item.company && item.title ? `${slug(item.company)}|${slug(item.title)}` : item.url;
        const current = best.get(key);
        const score = (x) => (x.source === 'web' ? 2 : 0) + (x.stipendMinMonthly != null ? 1 : 0);
        if (!current || score(item) > score(current)) best.set(key, item);
    }
    return [...best.values()];
}
