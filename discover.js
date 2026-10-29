import { Actor, log } from 'apify';

/**
 * Sites we do not crawl directly: they are job boards or social sites, not the
 * official source. Internshala is handled by its own parser in parse.js.
 */
export const AGGREGATOR_DOMAINS = [
    'internshala.com', 'linkedin.com', 'indeed.com', 'naukri.com', 'glassdoor.com', 'unstop.com',
    'letsintern.com', 'youthall.com', 'simplyhired.com', 'ziprecruiter.com', 'monster.com',
    'foundit.in', 'wellfound.com', 'twenty19.com', 'freshersworld.com', 'shine.com',
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'reddit.com',
    'quora.com', 'medium.com', 'pinterest.com', 'wikipedia.org',
];

const CAMPUS_HOST = /(\.ac\.[a-z]{2}|\.edu(\.[a-z]{2})?)$/i;

export function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

export function classifyUrl(url) {
    const host = hostOf(url);
    const isAggregator = AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
    const isCampus = CAMPUS_HOST.test(host);
    return { host, isAggregator, isCampus, sourceType: isCampus ? 'campus' : isAggregator ? 'aggregator' : 'company' };
}

/** Turns role names into web search queries. */
export function buildQueries({ roles, locations = ['remote'], includeCampusSites = true }) {
    const exclude = AGGREGATOR_DOMAINS.slice(0, 8).map((d) => `-site:${d}`).join(' ');
    const queries = [];
    for (const role of roles) {
        for (const loc of locations) {
            queries.push({ query: `${role} internship ${loc} apply careers ${exclude}`, kind: 'company' });
        }
        if (includeCampusSites) {
            queries.push({
                query: `${role} internship (site:.ac.in OR site:.edu.in OR site:.edu) apply`,
                kind: 'campus',
            });
        }
    }
    return queries;
}

/**
 * Runs the queries through Apify's Google Search Scraper and returns unique,
 * crawlable result URLs (aggregators are dropped; they are not the official source).
 */
export async function discoverUrls({ queries, resultsPerQuery = 10, maxUrls = 60, countryCode = 'in' }) {
    const run = await Actor.call('apify/google-search-scraper', {
        queries: queries.map((q) => q.query).join('\n'),
        resultsPerPage: resultsPerQuery,
        maxPagesPerQuery: 1,
        countryCode,
        languageCode: 'en',
    });
    const { items } = await Actor.apifyClient.dataset(run.defaultDatasetId).listItems();

    const seen = new Set();
    const urls = [];
    for (const page of items) {
        for (const hit of page.organicResults ?? []) {
            const url = String(hit.url ?? '').split('#')[0];
            if (!url || seen.has(url)) continue;
            const info = classifyUrl(url);
            if (info.isAggregator) continue;
            seen.add(url);
            urls.push({ url, searchTitle: hit.title ?? '', ...info });
        }
    }
    log.info(`Web search: ${items.length} result page(s), ${urls.length} official-looking URL(s).`);
    return urls.slice(0, maxUrls);
}
