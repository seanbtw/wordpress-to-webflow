# Redirects, the URL manifest and the checker

## Build the manifest from every source

One file, `verify/url-manifest.csv`, with every source URL and what should happen to it on the new site: expected path, expected status, expected final destination, and a **content identity** (page title or an element id) so that an unrelated page or a soft 404 answering 200 is caught.

Sources, all of them:

- `inventory/urls.csv` (every public URL the local WordPress exposes, and the sitemap)
- the host's exported redirect rules, every enumerable source
- **what the live site actually does**: run `scripts/live-capture.mjs` over the list. WordPress holds redirects of its own (plugins, old slugs, canonical redirects) that are not in the host's export, and chains through them are common
- **every Search Console URL with 10 or more impressions**, with its live final destination, including URLs that 404 today but still get clicks
- any earlier crawl or URL list from a previous attempt
- every slug Webflow altered during import, and every deliberate path change

Classify the host rules as exact, wildcard, query-conditional, domain-conditional or external. Preserve external targets. Record a disposition for every rule whose target no longer exists; never drop one silently.

## Webflow redirect behaviour (tested on staging, Premium plan)

- **The redirect and robots.txt APIs are Enterprise-only** (403 on other plans). Use Site settings › Publishing › 301 redirects › Import with a CSV whose header is `source,target`.
- **An import replaces every existing redirect.** Always import the complete set.
- The import runs asynchronously; an "Import in progress" toast confirms the click landed. Verify by the dashboard list and then by the checker.
- **In old paths, put a `%` in front of each of these characters** (a prefix, not percent-encoding): `% - & * ( ) = _ + ?`. So `/old-page_2?id=7` is written `/old%-page%_2%?id%=7`. The brackets and star of a `(.*)` capture are the one exception and stay bare. Unescaped hyphens break wildcard rules silently (exact ones may happen to work).
- **Wildcards**: `(.*)` in the old path, `%1` in the target. Prefix rules work (`/name(.*)`).
- **Order**: rules apply in the order they were added, which for an import is the CSV row order, so put specific rules before wildcards. In testing Webflow also seemed to prefer the more specific of two prefix rules, but don't rely on that.
- **Matching is case-sensitive.** Trailing slashes are normalised first (`/x/` 301 → `/x`, then the rule), so a slash-ended old URL takes two hops.
- **A redirect drops the query string** unless the old path matches it (`/old%?search%=(.*)` → `/search?query=%1`).
- **`%3A` and `%2C` in a target are read as capture groups.** Write `:` and `,` literally.
- **A literal space is rejected.** Use `(.*)` in its place.
- Targets may carry a query string and may be external.

`scripts/staging-paths.mjs` lists every path the new site serves; run it first. `scripts/build-redirects.py` then applies the rules above to the exported host rules, the live capture and the config's `pathRewrites` and `redirects` settings, and writes the import CSV, the URL manifest and `inventory/redirects.csv`. The builder encodes these rules as they were observed; confirm the first import on staging with the checker before trusting a large one.

## Other redirects to remember

- The old sitemap paths (`/sitemap_index.xml`, per-type sitemaps) → `/sitemap.xml`. Some crawlers ask for them by name.
- Search: the old results path and query parameter → Webflow's `/search?query=`.
- Taxonomy archive URLs → the filtered listing, with the filter carried in the query string and a shim in the page script that understands the old parameter names.
- Root icons (`/favicon.ico`, `/apple-touch-icon.png`) if the old site served them.
- High-impression URLs that 404 today: redirect to the closest live page, and tell the owner.

## The checker

`scripts/check-urls.mjs` rewrites the host explicitly, records every hop, checks status and destination per hop, rejects any hop back to the old host, verifies the content identity, allows only the documented trailing-slash normalisation, and exits non-zero on any failure.

**Prove it first.** A fixture with one wrong destination and one missing URL must fail before the checker is trusted: copy `scripts/fixtures/fixture-manifest.example.csv` to `<verifyDir>/fixture-manifest.csv`, edit the rows for your site, and run `--fixture`. Every wrong row must be reported and every control row must pass. Then the real run against staging must report zero failures, and every legacy rule gets a tested outcome in the log.

Staging and the live site both rate-limit bursts. Throttle to about one request a second against the live site and retry 429s on staging.
