import { parseStipend } from './stipend.js';

const BASE = 'https://internshala.com';
const DETAIL_LINK = 'a[href*="/internship/detail/"], a[href*="/internship/"][href*="detail"]';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function firstText($card, selectors) {
    for (const selector of selectors) {
        const text = clean($card.find(selector).first().text());
        if (text) return text;
    }
    return '';
}

function absoluteUrl(href) {
    if (!href) return '';
    try {
        return new URL(href, BASE).toString().split('#')[0];
    } catch {
        return '';
    }
}

/** Finds the listing "cards" on a page. Falls back to walking up from detail links. */
function findCards($) {
    let cards = $('div.individual_internship, div[id^="individual_internship_"]').toArray();
    if (cards.length) return cards.map((el) => $(el));

    const seen = new Set();
    const found = [];
    $(DETAIL_LINK).each((_, link) => {
        let node = $(link);
        for (let depth = 0; depth < 7; depth++) {
            node = node.parent();
            if (!node.length) break;
            const text = node.text();
            if (/₹|unpaid|performance/i.test(text) && text.length < 2500) {
                const key = node.get(0);
                if (!seen.has(key)) {
                    seen.add(key);
                    found.push(node);
                }
                break;
            }
        }
    });
    return found;
}

/**
 * Reads one listing page and returns plain objects.
 * `pageIsRemote` is true for work-from-home listing URLs.
 */
export function parseListingPage($, { pageIsRemote = true, sourceUrl = '' } = {}) {
    const results = [];
    for (const $card of findCards($)) {
        const cardText = clean($card.text());

        const href = $card.attr('data-href')
            || $card.find(DETAIL_LINK).first().attr('href')
            || $card.find('a.job-title-href, a.view_detail_button').first().attr('href');
        const url = absoluteUrl(href);
        if (!url) continue;

        const title = firstText($card, ['.job-internship-name', '.profile', 'h3 a', 'h3', '.heading_4_5 a', 'a.job-title-href'])
            || clean($card.find(DETAIL_LINK).first().text());
        const company = firstText($card, ['.company-name', '.company_name a', '.company_name', '.company_and_premium a', 'h4']);

        let stipendText = firstText($card, ['.stipend', '.stipend_container', '.row-1-item.stipend']);
        if (!stipendText) {
            const m = cardText.match(/(₹\s*[\d,]+(?:\s*[-–]\s*₹?\s*[\d,]+)?\s*(?:\/\s*\w+|lump sum|per \w+)?|unpaid|performance[- ]based)/i);
            stipendText = m ? clean(m[0]) : '';
        }
        const stipend = parseStipend(stipendText);

        const durationMatch = cardText.match(/(\d+\s*(?:months?|weeks?))/i);
        const duration = firstText($card, ['.row-1-item:has(i.ic-16-calendar)', '.item_body.duration']) || (durationMatch ? clean(durationMatch[1]) : '');

        const locationText = firstText($card, ['.locations', '.location_link', '.row-1-item.locations']);
        const location = locationText || (pageIsRemote ? 'Work from home' : '');
        const isRemote = pageIsRemote || /work from home|remote/i.test(`${locationText} ${cardText}`);

        results.push({
            title,
            company,
            stipendText,
            stipendKind: stipend.kind,
            stipendMinMonthly: stipend.minMonthly,
            stipendMaxMonthly: stipend.maxMonthly,
            duration,
            location,
            isRemote,
            url,
            source: 'internshala',
            listingPage: sourceUrl,
        });
    }
    return results;
}

/** Turns "Business Development" into "business-development". */
export function toSlug(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function categoryUrl(category) {
    const slug = toSlug(category);
    return slug ? `${BASE}/internships/work-from-home-${slug}-internships/` : '';
}

/** Next page URL, given a listing URL that may already end in /page-N/ */
export function pageUrl(listingUrl, page) {
    const base = listingUrl.replace(/\/page-\d+\/?$/, '/').replace(/\/?$/, '/');
    return page <= 1 ? base : `${base}page-${page}/`;
}

/** Work-from-home pages have "work-from-home" in the URL. */
export function isRemoteListingUrl(url) {
    return /work-from-home|remote/i.test(url);
}
