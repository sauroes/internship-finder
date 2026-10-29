import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { parseStipend } from '../src/stipend.js';
import { applyFilters } from '../src/filters.js';
import { categoryUrl, pageUrl, parseListingPage, toSlug } from '../src/parse.js';

test('stipend: ranges, fixed, units', () => {
    assert.deepEqual(parseStipend('₹ 10,000 - 20,000 /month'), { minMonthly: 10000, maxMonthly: 20000, kind: 'range' });
    assert.deepEqual(parseStipend('₹ 15,000 /month'), { minMonthly: 15000, maxMonthly: 15000, kind: 'fixed' });
    assert.equal(parseStipend('₹ 5,000 /week').minMonthly, 20000);
    assert.equal(parseStipend('₹ 3,60,000 /year').minMonthly, 30000);
    assert.equal(parseStipend('₹ 3,500 /month + 10% share').maxMonthly, 3500);
    assert.equal(parseStipend('20k - 30k /month').maxMonthly, 30000);
});

test('stipend: unpaid, lump sum, empty', () => {
    assert.equal(parseStipend('Unpaid').kind, 'unpaid');
    assert.equal(parseStipend('₹ 10,000 lump sum').minMonthly, null);
    assert.equal(parseStipend('Performance based').kind, 'performance');
    assert.equal(parseStipend('').kind, 'unknown');
});

test('urls', () => {
    assert.equal(toSlug('Business Development'), 'business-development');
    assert.equal(categoryUrl('AI / ML'), 'https://internshala.com/internships/work-from-home-ai-ml-internships/');
    assert.equal(pageUrl('https://internshala.com/internships/work-from-home-marketing-internships/', 2),
        'https://internshala.com/internships/work-from-home-marketing-internships/page-2/');
    assert.equal(pageUrl('https://x.com/a/page-3/', 1), 'https://x.com/a/');
});

const CLASSIC = `
<div id="individual_internship_1" class="individual_internship" data-href="/internship/detail/founders-office-intern-at-acme1">
  <h3 class="job-internship-name"><a class="job-title-href" href="/internship/detail/founders-office-intern-at-acme1">Founder's Office Intern</a></h3>
  <p class="company-name">Acme AI</p>
  <div class="row-1-item locations"><span>Work from home</span></div>
  <div class="row-1-item"><span class="stipend">₹ 20,000 - 30,000 /month</span></div>
  <div class="other_detail_item"><div class="item_body">3 Months</div></div>
</div>
<div id="individual_internship_2" class="individual_internship" data-href="/internship/detail/sales-executive-at-foo2">
  <h3 class="job-internship-name"><a class="job-title-href" href="/internship/detail/sales-executive-at-foo2">Sales Executive</a></h3>
  <p class="company-name">Foo</p>
  <span class="stipend">₹ 8,000 /month</span>
</div>`;

const UNKNOWN_LAYOUT = `
<section><div class="x"><div class="y">
  <a href="/internship/detail/growth-intern-at-bar3">Growth Intern</a>
  <span>Bar Labs</span><span>₹ 18,000 /month</span><span>2 Months</span>
</div></div></section>`;

test('parser: classic layout', () => {
    const items = parseListingPage(load(CLASSIC), { pageIsRemote: true, sourceUrl: 'u' });
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "Founder's Office Intern");
    assert.equal(items[0].company, 'Acme AI');
    assert.equal(items[0].stipendMinMonthly, 20000);
    assert.equal(items[0].duration, '3 Months');
    assert.equal(items[0].url, 'https://internshala.com/internship/detail/founders-office-intern-at-acme1');
    assert.equal(items[0].isRemote, true);
});

test('parser: fallback when classes change', () => {
    const items = parseListingPage(load(UNKNOWN_LAYOUT), { pageIsRemote: true });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Growth Intern');
    assert.equal(items[0].stipendMinMonthly, 18000);
});

test('filters', () => {
    const all = [
        ...parseListingPage(load(CLASSIC), { pageIsRemote: true }),
        ...parseListingPage(load(UNKNOWN_LAYOUT), { pageIsRemote: true }),
    ];
    const { items, stats } = applyFilters(all, { minStipendPerMonth: 15000, excludeTitleKeywords: ['sales executive'] });
    assert.deepEqual(items.map((i) => i.title), ["Founder's Office Intern", 'Growth Intern']);
    assert.equal(stats.excludedTitle, 1);
    const strict = applyFilters(all, { minStipendPerMonth: 25000, matchOn: 'min' });
    assert.equal(strict.items.length, 0);
    const lenient = applyFilters(all, { minStipendPerMonth: 25000, matchOn: 'max' });
    assert.equal(lenient.items.length, 1);
});
