# Structured data (JSON-LD) on a Webflow site

Works for any Webflow site, migrated or not. The purpose is identity: tie the brand to its legal company, its parent, and its public records, so search engines and AI assistants stop guessing.

## The pattern

Every indexable page carries:

- **Organization**, with a stable id `<origin>/#organization`: `name`, `legalName` (exactly as the company register has it), `alternateName` where the trading and legal names differ, `url`, `logo`, `address` (`addressCountry` as the ISO code, for example "GB"), `parentOrganization` where there is one, and `sameAs`.
- **WebSite**, id `<origin>/#website`, publisher → the Organization id.

`sameAs` holds the company's own public records: its Wikidata item, its LinkedIn company page (copied as the site links it), and its company-register page.

`parentOrganization` points at the parent's own id on the parent's site, so every subsidiary site names the same node:

```json
"parentOrganization": {
  "@type": "Organization",
  "@id": "https://parent.example/#organization",
  "name": "Parent Group",
  "url": "https://parent.example",
  "sameAs": "https://www.wikidata.org/wiki/Q…"
}
```

Then per page type:

- inner static pages: `WebPage` (or `AboutPage`, `ContactPage`, `CollectionPage`) plus `BreadcrumbList`. On a migrated site, take each breadcrumb name from the list the old SEO plugin already printed for that URL (HTML-decoded), so no wording is invented
- articles: `Article` or `BlogPosting` with headline, dates, image, and an author. Head-code placeholders cannot read fields of a referenced item, so a `Person` author cannot be server-rendered from an author reference. Either copy the author's name and role into plain fields on the article at import and bind those, or print the Organization as author and let a script upgrade it to a `Person` from data on the page (seen by Google, not by crawlers that skip JavaScript). Head code has no conditionals, and an embed hidden by CSS still prints, so "a Person when there is an author, otherwise the Organization" has no server-rendered route: keep the Organization as the HTML default and say so in the report
- people: `Person` from what the page shows and nothing more (name and role; `sameAs` only when a profile link exists)
- projects and case studies: `CreativeWork` with name, headline, description, image, location, `creator` → the Organization id
- services: `Service` with `provider` → the Organization id
- FAQs: `FAQPage` built from the items on the page, skipping empty and placeholder answers. A static component cannot print its own props into a JSON-LD embed, so FAQ blocks made of components need a script to assemble it; a CMS-driven list can carry a server-rendered one

## Rules

- **Every string comes from a source**: the live page, a CMS field, or the company register. Build all blocks from one generator script that stops if a string is missing. Nothing is paraphrased.
- **Don't state what the site doesn't.** No founding date when the only date available is a register incorporation date for a differently named predecessor.
- **Leave out pages that are noindex, the 404 and password pages, drafts, and template leftovers.** Report leftovers; they often sit in the sitemap as dead URLs.
- **One canonical origin** for every id. If both `www` and the bare domain serve the site, say so; the fix is a default-domain setting, not markup.
- Where two official sources disagree (a building name on the contact page versus the register), pick one, say which and why, and list it for the owner.

## Where to put it in Webflow

Least invasive first:

1. **Static pages: the page's native "Schema markup" field.** Webflow prints it in the head. This avoids touching shared code.
2. **CMS templates: template custom code with field placeholders**, so the block is server-rendered per item (see `webflow-traps.md`, "Pages, templates and head code"). Append to what is there; if the head already holds other scripts, an empty footer block is a safe home.
3. **Site head code** only if the above cannot do it. The API replaces the whole block: read it, save a backup copy, and write back everything that was there plus yours. A site token needs the custom-code scope for this (403 without it); the MCP can write it instead.

Placeholders are HTML-escaped but not JSON-escaped: **a line break in a bound field makes that item's JSON invalid.** Check every item, and tell the owner which fields must stay on one line. HTML-escaping also means an `&` in a name is printed as `&amp;` inside the JSON: valid JSON, wrong text for a reader that does not decode it. List the items it affects.

Keep the JSON-LD records in page and template head code, one per page type, written by one generator script; never in the site-wide head code, which other people's scripts share.

Script-built JSON-LD (for example an FAQ block assembled in the browser) is read by Google but not by crawlers that don't run JavaScript. Prefer server-rendered blocks.

## Checking

- `scripts/verify-jsonld.mjs`: every sitemap URL fetched without JavaScript; each block is valid JSON; every `@id` reference resolves on its page; no empty values, leftover placeholders or `&quot;`; every text value appears on the page, elsewhere on the site, or in the facts file (a small JSON file you keep per site with the register facts: legal name, company number, registered office, parent, and the URL each came from); CMS-driven values equal the CMS. Script-built blocks need a second pass in a real browser.
- Both JSON-LD scripts read the sitemap from the live origin by default. Before a migrated site launches that is still WordPress, so pass `--sitemap-origin` with the staging address.
- `scripts/schema-vocab-check.mjs`: every type and property against schema.org's own vocabulary file. Use this when validator.schema.org answers scripted requests with a CAPTCHA.
- validator.schema.org by script, when it answers: `POST /validate` with `url=<page>` form-encoded, sent from a page on the validator's own origin; the reply is JSON after a `)]}'` prefix.
- **Google's Rich Results Test only fetches public URLs.** A webflow.io staging address with `robots.txt` `Disallow: /` cannot be tested by URL; test live pages after publishing, one of each type.
- Compare the console and the rendered pages before and after: markup should change nothing a visitor sees.

## Publishing safely

This applies once the live domain is served by Webflow (during a migration there is only the staging address, and nothing here is needed until cutover). A live publish ships everything unpublished on the site, not just your change. Before asking the owner for the go-ahead:

1. Record the site's last-published and last-updated times before you touch anything. A last-updated a few seconds after last-published is Webflow's bookkeeping; a later one means someone has unpublished work.
2. Before any change, compare staging with live page by page (`scripts/diff-staging-live.py`). Identical means nothing is waiting.
3. Make your change and publish to the staging address only. Compare again, ignoring JSON-LD: the only differences should be yours, plus possibly Webflow's own runtime script if the platform has updated.
4. State exactly what a live publish would ship. Publish live only on the owner's own yes. Re-check last-updated just before publishing.
5. After the live publish, rerun the checks against the live origin and note the time.

## Wikidata

A Wikidata item per company is what makes `sameAs` meaningful.

- **Search for an existing item first**, including former names. Note same-label items it must be told apart from.
- **Statements worth having**, each with a reference URL and a retrieved date: instance of (business), country, headquarters location with street address and postal code, inception (with the determination method when it is an incorporation date), company-register id, legal form, official name (with dates where names changed), official website (the canonical address), parent organization, industry, LinkedIn id. Add the inverse statement (has subsidiary) on the parent's item.
- **Description from the site's own words**, short enough to tell the item apart from others with the same label.
- **Reference the parent link to the strongest source**: a register of controlling shareholders beats "a group company" in a footer.
- **No items for people** without that person's approval.
- **Editing**: through the owner's signed-in browser session, never by signing in for them. In a tab on wikidata.org:

```js
const api = new mw.Api();
await api.postWithToken('csrf', { action: 'wbsetdescription', id: 'Q…', language: 'en',
  value: '…', summary: 'description verbatim from https://example.com/about' });
```

  `wbsetclaimvalue` changes a statement's value and keeps its references; `wbsetreference` without a `reference` hash adds a second reference. A first call can fail with `failed-save` and succeed on an identical retry. Read the result back from the public data (`Special:EntityData/Q….json`) without signing in.
- Write a to-do file with what is already on the item, each proposed edit, its source, and the exact command, so the edit can be run later if the browser is not connected.
