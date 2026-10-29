import { parseStipend } from './stipend.js';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const stripHtml = (v) => clean(String(v ?? '').replace(/<[^>]+>/g, ' '));
const looksLikeInternship = (text) => /\bintern(ship|s)?\b/i.test(text);

/** Annual/weekly/monthly figures to INR per month. Hourly and daily are ambiguous, so they give null. */
function salaryToMonthly(amount, unit) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return null;
    const n = Number(amount);
    switch (String(unit ?? '').toUpperCase()) {
        case 'MONTH': return Math.round(n);
        case 'WEEK': return Math.round(n * 4);
        case 'YEAR': return Math.round(n / 12);
        default: return null;
    }
}

function flattenJsonLd(node, out = []) {
    if (Array.isArray(node)) node.forEach((n) => flattenJsonLd(n, out));
    else if (node && typeof node === 'object') {
        out.push(node);
        if (node['@graph']) flattenJsonLd(node['@graph'], out);
    }
    return out;
}

function locationFrom(posting) {
    const loc = Array.isArray(posting.jobLocation) ? posting.jobLocation[0] : posting.jobLocation;
    const a = loc?.address;
    if (!a) return '';
    if (typeof a === 'string') return clean(a);
    return clean([a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter(Boolean).join(', '));
}

/** Reads schema.org JobPosting data, which many careers and campus pages publish. */
export function extractJsonLd($, { url }) {
    const results = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        let data;
        try { data = JSON.parse($(el).contents().text()); } catch { return; }
        for (const node of flattenJsonLd(data)) {
            const types = [].concat(node['@type'] ?? []);
            if (!types.includes('JobPosting')) continue;

            const title = clean(node.title ?? node.name);
            const employmentType = [].concat(node.employmentType ?? []).join(' ');
            if (!looksLikeInternship(`${title} ${employmentType}`)) continue;

            const salary = node.baseSalary?.value ?? node.baseSalary;
            const currency = node.baseSalary?.currency ?? salary?.currency;
            const unit = salary?.unitText;
            const low = salary?.minValue ?? salary?.value;
            const high = salary?.maxValue ?? salary?.value;
            const inr = !currency || /INR/i.test(currency);
            const minMonthly = inr ? salaryToMonthly(low, unit) : null;
            const maxMonthly = inr ? salaryToMonthly(high ?? low, unit) : null;
            const stipendText = low !== undefined
                ? `${currency ?? ''} ${low}${high && high !== low ? ` - ${high}` : ''}${unit ? ` / ${String(unit).toLowerCase()}` : ''}`.trim()
                : '';

            const description = stripHtml(node.description);
            results.push({
                title,
                company: clean(node.hiringOrganization?.name ?? node.hiringOrganization),
                stipendText,
                stipendKind: minMonthly === null ? 'unknown' : minMonthly === maxMonthly ? 'fixed' : 'range',
                stipendMinMonthly: minMonthly,
                stipendMaxMonthly: maxMonthly,
                duration: (description.match(/(\d+\s*(?:-\s*\d+\s*)?(?:months?|weeks?))/i) ?? [])[1] ?? '',
                location: node.jobLocationType === 'TELECOMMUTE' ? 'Remote' : locationFrom(node),
                isRemote: node.jobLocationType === 'TELECOMMUTE' || /remote|work from home|wfh/i.test(`${locationFrom(node)} ${title}`),
                deadline: clean(node.validThrough),
                url: node.url || url,
                extractedBy: 'json-ld',
            });
        }
    });
    return results;
}

/** Fallback for pages with no structured data: titles, meta tags and a few text patterns. */
export function extractHeuristic($, { url }) {
    const body = clean($('main').text() || $('body').text());
    if (!looksLikeInternship(`${$('title').text()} ${$('h1').first().text()}`)) return null;

    const title = clean($('h1').first().text()) || clean($('meta[property="og:title"]').attr('content')) || clean($('title').text());
    const company = clean($('meta[property="og:site_name"]').attr('content'));

    const stipendMatch = body.match(/(?:stipend|salary|compensation)[^₹\d]{0,30}(₹\s*[\d,]+(?:\s*[-–]\s*₹?\s*[\d,]+)?(?:\s*(?:\/|per)\s*\w+)?)/i)
        ?? body.match(/(₹\s*[\d,]+(?:\s*[-–]\s*₹?\s*[\d,]+)?\s*(?:\/|per)\s*(?:month|week|year))/i);
    const stipend = parseStipend(stipendMatch?.[1] ?? '');
    const duration = (body.match(/(\d+\s*(?:-\s*\d+\s*)?(?:months?|weeks?))/i) ?? [])[1] ?? '';
    const deadline = (body.match(/(?:apply by|last date(?: to apply)?|deadline)[:\s-]+([A-Za-z0-9 ,/-]{4,30})/i) ?? [])[1] ?? '';

    return {
        title,
        company,
        stipendText: clean(stipendMatch?.[1]),
        stipendKind: stipend.kind,
        stipendMinMonthly: stipend.minMonthly,
        stipendMaxMonthly: stipend.maxMonthly,
        duration,
        location: '',
        isRemote: /work from home|remote|wfh|virtual internship/i.test(body.slice(0, 4000)),
        deadline: clean(deadline),
        url,
        extractedBy: 'heuristic',
    };
}

/** Last resort for odd layouts: ask Claude to read the page text and fill a fixed schema. */
export async function extractWithLlm(text, { url, apiKey, model }) {
    const prompt = `Page URL: ${url}\n\nPage text:\n${text.slice(0, 12000)}\n\n`
        + 'If this page describes ONE specific internship, return JSON only (no prose, no code fences) with keys: '
        + 'title, company, stipendText (as written, "" if none), duration, location, isRemote (boolean), deadline, eligibility. '
        + 'If it is not a specific internship posting, return {"notAnInternship": true}. Never guess; use "" for anything not stated.';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`LLM extraction failed (${res.status})`);
    const data = await res.json();
    const raw = (data.content ?? []).map((b) => b.text ?? '').join('').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    if (parsed.notAnInternship) return null;
    const stipend = parseStipend(parsed.stipendText);
    return {
        title: clean(parsed.title),
        company: clean(parsed.company),
        stipendText: clean(parsed.stipendText),
        stipendKind: stipend.kind,
        stipendMinMonthly: stipend.minMonthly,
        stipendMaxMonthly: stipend.maxMonthly,
        duration: clean(parsed.duration),
        location: clean(parsed.location),
        isRemote: Boolean(parsed.isRemote),
        deadline: clean(parsed.deadline),
        eligibility: clean(parsed.eligibility),
        url,
        extractedBy: 'llm',
    };
}

/** Same-domain links on a careers/index page that look like internship postings. */
export function internshipLinks($, baseUrl, limit = 10) {
    const base = new URL(baseUrl);
    const found = new Set();
    $('a[href]').each((_, a) => {
        if (found.size >= limit) return;
        const text = clean($(a).text());
        try {
            const u = new URL($(a).attr('href'), base);
            if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) return;
            if (looksLikeInternship(`${text} ${u.pathname}`)) found.add(u.toString().split('#')[0]);
        } catch { /* ignore bad links */ }
    });
    return [...found].filter((u) => u !== baseUrl);
}
