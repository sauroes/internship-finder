# Remote Internship Finder

Collects **work-from-home internship listings** and keeps only those that pay at least the **minimum monthly stipend** you set. Results are sorted with the best-paying first.

## What you get

For each listing: role title, company, stipend text, stipend min and max per month (INR), duration, location, and a link to the listing.

## Input

| Field | What it does | Default |
|---|---|---|
| `categories` | Role categories (the words in the listing URL, e.g. `business-development`, `marketing`) | 5 common roles |
| `searchUrls` | Internshala listing pages you already filtered in your browser | none |
| `minStipendPerMonth` | Drop anything below this (INR) | 15000 |
| `matchOn` | `min` compares against the bottom of a stipend range (stricter), `max` against the top | `min` |
| `includeUnknownStipend` | Keep listings with no stated stipend | off |
| `excludeTitleKeywords` | Drop titles containing these words | sales, telecaller, etc. |
| `maxPagesPerListing` | Result pages read per listing | 3 |
| `maxResults` | Cap on saved results | 100 |

Example:

```json
{
  "categories": ["business-development", "artificial-intelligence-ai"],
  "minStipendPerMonth": 20000,
  "matchOn": "min",
  "maxPagesPerListing": 3
}
```

## Output

A dataset (open the **Remote internships** view for a table) plus a `SUMMARY` record in the key-value store showing how many listings were collected and why others were dropped (below minimum, no stipend, excluded title).

## Important notes

- **This is a first version and has not been run against the live site.** The page parser was tested on sample HTML only. If a run returns zero listings, open the listing URL in your browser and tell me what you see, since the page layout may need a selector update.
- Stipends are converted to INR per month. Weekly and yearly figures are converted; lump-sum and unpaid listings get no monthly figure.
- The crawler is deliberately slow (2 requests at a time, about 20 a minute) and checks `robots.txt`. Read the site's terms of use before scraping, and keep runs small.
- Listings can close or change after you collect them, so check each one before applying.

## Run it

1. Install the CLI: `npm install -g apify-cli`, then `apify login`.
2. In this folder: `npm install`, then `apify run` to test locally (put your input in `storage/key_value_stores/default/INPUT.json`).
3. Deploy: `apify push`.
