import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { applyFilters, dedupe } from './filters.js';
import { categoryUrl, isRemoteListingUrl, pageUrl, parseListingPage } from './parse.js';
import { buildQueries, classifyUrl, discoverUrls } from './discover.js';
import { extractHeuristic, extractJsonLd, extractWithLlm, internshipLinks } from './extract.js';

await Actor.init();

const crawlerDefaults = {
    maxConcurrency: 2,
    maxRequestsPerMinute: 20,
    maxRequestRetries: 2,
    respectRobotsTxtFile: true,
};

/** Original Internshala crawl, unchanged in behaviour. */
async function crawlInternshala({ categories, searchUrls, maxPagesPerListing, proxy }) {
    const listingUrls = new Set();
    for (const category of categories) {
        const url = categoryUrl(category);
        if (url) listingUrls.add(url);
    }
    for (const entry of searchUrls) {
        const url = typeof entry === 'string' ? entry : entry?.url;
        if (url) listingUrls.add(pageUrl(url, 1));
    }
    if (!listingUrls.size) return [];
    log.info(`Internshala: reading ${listingUrls.size} listing(s), up to ${maxPagesPerListing} page(s) each.`);

    const collected = new Map();
    const crawler = new CheerioCrawler({
        ...crawlerDefaults,
        proxyConfiguration: proxy,
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
                    collected.set(item.url, { ...item, sourceType: 'aggregator', scrapedAt: new Date().toISOString() });
                    added++;
                }
            }
            if (added > 0 && page < maxPagesPerListing) {
                await self.addRequests([{ url: pageUrl(listingBase, page + 1), userData: { listingBase, page: page + 1 } }]);
            }
        },
        failedRequestHandler({ request }, error) {
            log.warning(`Skipped ${request.url}: ${error.message}`);
        },
    });
    await crawler.run([...listingUrls].map((url) => ({ url, userData: { listingBase: url, page: 1 } })));
    if (!collected.size) log.warning('Internshala: no listings parsed. The layout may have changed or the request was blocked.');
    return [...collected.values()];
}

/** Searches the wider web, then reads official company and campus pages. */
async function crawlWeb({ roles, locations, includeCampusSites, maxWebUrls, llm, proxy }) {
    const queries = buildQueries({ roles, locations, includeCampusSites });
    if (!queries.length) return [];
    const found = await discoverUrls({ queries, maxUrls: maxWebUrls });
    const kindByUrl = new Map(found.map((f) => [f.url, f]));

    const collected = new Map();
    const crawler = new CheerioCrawler({
        ...crawlerDefaults,
        proxyConfiguration: proxy,
        maxRequestsPerCrawl: maxWebUrls * 4,
        async requestHandler({ $, request, body, crawler: self }) {
            const url = request.loadedUrl ?? request.url;
            const info = kindByUrl.get(request.url) ?? classifyUrl(url);
            const depth = request.userData.depth ?? 0;

            let postings = extractJsonLd($, { url });
            if (!postings.length) {
                const guess = extractHeuristic($, { url });
                if (guess) postings = [guess];
            }
            // Pages without usable structure: let Claude read them, if the user turned that on.
            if (!postings.length && llm && /\bintern/i.test($('body').text())) {
                try {
                    const text = $('body').text().replace(/\s+/g, ' ');
                    const viaLlm = await extractWithLlm(text, { url, ...llm });
                    if (viaLlm) postings = [viaLlm];
                } catch (error) {
                    log.warning(`LLM read failed for ${url}: ${error.message}`);
                }
            }

            for (const p of postings) {
                if (collected.has(p.url)) continue;
                collected.set(p.url, {
                    ...p,
                    source: 'web',
                    sourceType: info.sourceType,
                    domain: info.host,
                    officialUrl: p.url,
                    listingPage: url,
                    scrapedAt: new Date().toISOString(),
                });
            }
            log.info(`${url}: ${postings.length} internship(s)`);

            // A careers index page: follow its internship links one level down.
            if (!postings.length && depth === 0) {
                const links = internshipLinks($, url);
                if (links.length) {
                    await self.addRequests(links.map((u) => ({ url: u, userData: { depth: 1 } })));
                }
            }
        },
        failedRequestHandler({ request }, error) {
            log.warning(`Skipped ${request.url}: ${error.message}`);
        },
    });
    await crawler.run(found.map((f) => ({ url: f.url, userData: { depth: 0 } })));
    return [...collected.values()];
}

try {
    const input = (await Actor.getInput()) ?? {};
    const {
        sources = ['internshala', 'web'],
        categories = ['business-development', 'artificial-intelligence-ai', 'marketing'],
        searchUrls = [],
        webRoles = [],
        webLocations = ['remote'],
        includeCampusSites = true,
        maxWebUrls = 40,
        minStipendPerMonth = 15000,
        matchOn = 'min',
        includeUnknownStipend = false,
        includeUnknownStipendWeb = true,
        remoteOnly = true,
        excludeTitleKeywords = [],
        maxPagesPerListing = 3,
        maxResults = 100,
        llmExtraction = false,
        anthropicApiKey,
        llmModel = 'claude-haiku-5-5',
        proxyConfiguration,
    } = input;

    if (!Number.isFinite(minStipendPerMonth) || minStipendPerMonth < 0) {
        throw new Error('minStipendPerMonth must be a number of 0 or more.');
    }
    if (!['min', 'max'].includes(matchOn)) throw new Error("matchOn must be 'min' or 'max'.");
    if (llmExtraction && !anthropicApiKey) throw new Error('Turn off llmExtraction or provide anthropicApiKey.');

    const proxy = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;
    let all = [];

    if (sources.includes('internshala')) {
        all.push(...await crawlInternshala({ categories, searchUrls, maxPagesPerListing, proxy }));
    }
    if (sources.includes('web')) {
        const roles = webRoles.length ? webRoles : categories.map((c) => c.replace(/-/g, ' '));
        all.push(...await crawlWeb({
            roles,
            locations: webLocations,
            includeCampusSites,
            maxWebUrls,
            llm: llmExtraction ? { apiKey: anthropicApiKey, model: llmModel } : null,
            proxy,
        }));
    }
    if (!all.length) throw new Error('Nothing collected. Check the sources and inputs.');

    const before = all.length;
    all = dedupe(all);
    const { items, stats } = applyFilters(all, {
        minStipendPerMonth, matchOn, includeUnknownStipend, includeUnknownStipendWeb,
        remoteOnly, excludeTitleKeywords, maxResults,
    });
    stats.duplicatesRemoved = before - all.length;
    stats.bySource = all.reduce((acc, i) => ({ ...acc, [i.source]: (acc[i.source] ?? 0) + 1 }), {});

    await Actor.pushData(items);
    await Actor.setValue('SUMMARY', { minStipendPerMonth, matchOn, ...stats });
    log.info(`Done. ${stats.kept} of ${stats.collected} listings kept.`, stats);
} catch (error) {
    log.error(`Run failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
