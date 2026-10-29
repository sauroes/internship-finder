import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { applyFilters } from './filters.js';
import { categoryUrl, isRemoteListingUrl, pageUrl, parseListingPage } from './parse.js';

await Actor.init();

try {
    const input = (await Actor.getInput()) ?? {};
    const {
        categories = ['business-development', 'artificial-intelligence-ai', 'marketing'],
        searchUrls = [],
        minStipendPerMonth = 15000,
        matchOn = 'min',
        includeUnknownStipend = false,
        excludeTitleKeywords = [],
        maxPagesPerListing = 3,
        maxResults = 100,
        proxyConfiguration,
    } = input;

    if (!Number.isFinite(minStipendPerMonth) || minStipendPerMonth < 0) {
        throw new Error('minStipendPerMonth must be a number of 0 or more.');
    }
    if (!['min', 'max'].includes(matchOn)) {
        throw new Error("matchOn must be 'min' or 'max'.");
    }

    // Build the first page of every listing we were asked to read.
    const listingUrls = new Set();
    for (const category of categories) {
        const url = categoryUrl(category);
        if (url) listingUrls.add(url);
    }
    for (const entry of searchUrls) {
        const url = typeof entry === 'string' ? entry : entry?.url;
        if (url) listingUrls.add(pageUrl(url, 1));
    }
    if (!listingUrls.size) throw new Error('Give at least one category or listing URL.');
    log.info(`Reading ${listingUrls.size} listing(s), up to ${maxPagesPerListing} page(s) each.`);

    const collected = new Map();
    const proxy = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

    const crawler = new CheerioCrawler({
        proxyConfiguration: proxy,
        maxConcurrency: 2,
        maxRequestsPerMinute: 20,
        maxRequestRetries: 2,
        respectRobotsTxtFile: true,
        async requestHandler({ $, request, crawler: self }) {
            const { listingBase, page } = request.userData;
            const items = parseListingPage($, {
                pageIsRemote: isRemoteListingUrl(listingBase),
                sourceUrl: request.loadedUrl ?? request.url,
            });
            log.info(`${request.url}: found ${items.length} listing(s).`);

            let added = 0;
            for (const item of items) {
                if (!collected.has(item.url)) {
                    collected.set(item.url, { ...item, scrapedAt: new Date().toISOString() });
                    added++;
                }
            }
            // Only keep paging while pages still bring new listings.
            if (added > 0 && page < maxPagesPerListing) {
                await self.addRequests([{
                    url: pageUrl(listingBase, page + 1),
                    userData: { listingBase, page: page + 1 },
                }]);
            }
        },
        failedRequestHandler({ request }, error) {
            log.warning(`Skipped ${request.url}: ${error.message}`);
        },
    });

    await crawler.run([...listingUrls].map((url) => ({
        url,
        userData: { listingBase: url, page: 1 },
    })));

    const { items, stats } = applyFilters([...collected.values()], {
        minStipendPerMonth, matchOn, includeUnknownStipend, excludeTitleKeywords, maxResults,
    });

    if (!collected.size) {
        log.warning('No listings were parsed. The site layout may have changed, or the request was blocked. Try a proxy or check the listing URL in a browser.');
    }

    await Actor.pushData(items);
    await Actor.setValue('SUMMARY', { minStipendPerMonth, matchOn, ...stats });
    log.info(`Done. ${stats.kept} of ${stats.collected} listings kept.`, stats);
} catch (error) {
    log.error(`Run failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
