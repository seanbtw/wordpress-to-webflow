---
name: wordpress-to-webflow
description: Rebuild a WordPress site in Webflow so it looks and behaves the same, keeps every URL that matters, and stays editable by the site's own team. Use this whenever someone wants to move, migrate, rebuild or recreate a WordPress site (WP Engine, ACF, Yoast, custom themes, page builders) in Webflow, import WordPress content into Webflow CMS, turn WordPress or host redirect rules into Webflow 301s, check a Webflow rebuild against the old site, add JSON-LD schema markup to a Webflow site, test that editors can add new CMS items, or plan the DNS cutover. Use it even when they ask about only one of those steps, and when they hit a Webflow API or MCP limit (Collection Lists, components, slots, redirects, sitemap) during any Webflow build.
---

# WordPress to Webflow

A method for rebuilding a WordPress site in Webflow, written from a full migration (about 500 CMS items, 30 pages, 24 theme blocks) and three follow-up schema jobs. It exists because the obvious way fails: rebuilding pages by eye from the live site gets the colours right and nearly everything else subtly wrong (breakpoints, spacing tiers, which element carries which rule, behaviour, URLs). The method below replaces looking with measuring.

## The method in five sentences

1. **Build from source, not by eye.** The WordPress theme and database are the specification. Run the backup locally and treat that copy as the reference for every comparison.
2. **Inventory before building.** Every page, post, field, option, asset, URL and SEO value goes into machine-readable files, and the acceptance counts are generated from them, never typed.
3. **Prove the risky parts small.** Settle component versus Collection List boundaries, body conversion, curation, filtering past 100 items and search on a handful of real examples before building at scale.
4. **Import idempotently.** Identity is the WordPress id, not the slug, so the import can be rerun at cutover without duplicates.
5. **Verify by script, with evidence.** A claim without output (counts, command results, file paths, screenshots) does not count as done.

## What this assumes you have

- **The Webflow MCP server** connected, with its Designer companion ("MCP Bridge") app. Most building is done through it; `references/webflow-traps.md` names the tools. Calls that work with no Designer tab open are called *headless* here; some need the Designer open on the site with the Bridge launched.
- **A browser you can drive** for the few Designer-only steps, signed in by the owner.
- **Docker**, Node 20 or later, Python 3, and Playwright for the local reference and the checks.
- **The Webflow Data API v2** with a site token, for bulk CMS work.

## What to get from the site owner first

These are the steps only a person can do. Ask for all of them at the start, saying where each is done, then carry on with everything that does not depend on them.

| Needed | Where the owner does it | Why |
|---|---|---|
| A new, empty Webflow site on a plan whose collection and item limits exceed the inventory counts, and its site id | Webflow dashboard | Never resume a half-built earlier attempt; keep it as a reference only |
| A site API token with CMS, Sites and Pages scopes, saved as `WEBFLOW_TOKEN=` in a local `.env` | Site settings › Apps & integrations › API access | Bulk import. Never printed, logged or pasted in chat. Site head and footer code needs a further scope, or is written through the MCP |
| A full backup of the WordPress site: files plus database dump | The host's backup tool | The local reference |
| The host's redirect rules export | The host's redirect settings | Redirects often live at the host, outside WordPress |
| Read access to Search Console and analytics for a service account, if available | Search Console › Settings › Users and permissions | Which URLs and pages matter; the SEO baseline |
| Brand fonts uploaded to the Webflow site | Site settings › Fonts | Fonts cannot be guessed |
| The staging host (`<short-name>.webflow.io/*`) added to any referrer-restricted API key, such as maps | The key's settings in its cloud console | Otherwise maps fail on staging |
| A test-contact procedure for any live form or CRM provider | Agreed with whoever owns the CRM | No test submission before it exists |

## Working rules

- **Never write, reword or invent copy.** Every word on the new site comes from the old one. If the source is missing something, leave it out and say so. This applies to structured data too: every string comes from a page, a CMS field or an official register.
- **Keep four files in the project folder** and read them at the start of every session and after every context compaction: `PLAN.md` (decisions and phase gates), `PROGRESS.md` (dated log: what was done, the evidence, what is open), `LEARNINGS.md` (one dated entry per discovery), `site.config.json` (every site-specific value; copy `assets/site.config.example.json`). Scripts read the config, so nothing site-specific is hard-coded and the work carries to the next site.
- **Within any one structure, API writes first and Designer steps last.** Once the Designer has edited inside an API-built structure, the API may refuse further writes to it. After any structural change to components, slots or lists, do one throwaway attribute write (a canary) and stop at the first failure. Take a named manual backup before risky component work.
- **Work on the staging address only.** Publishing to a live domain is the owner's decision each time. Once the live domain is on Webflow, prove what a publish would ship before asking (see `references/structured-data.md`, "Publishing safely").
- **Behaviour lives in one script file and one CSS file**, served from immutable hashed paths so rollback is a one-line change (see `references/phases.md`, Phase 5). Custom-code fields hold only the two lines that load that release, meta and Open Graph tags, JSON-LD, a tiny early inline script where unavoidable, and third-party loaders gated to the live hostname. No behaviour code is pasted into pages.
- **Secrets stay in files**: tokens and service-account keys are read from disk by scripts, never echoed, never committed. The live site's credentials are used nowhere in the local copy.
- **Report plainly at each phase boundary**: the phase's "Done when" list with the evidence beside each line.

## Phases

Each phase has a gate. Do not start the next until the gate's evidence is in `PROGRESS.md`. The steps and the "Done when" list for every phase are in `references/phases.md`.

| Phase | What | Also read |
|---|---|---|
| 0 | Local WordPress from the backup, inventories, reference screenshots, proof the tools work | `references/wordpress-side.md` |
| 1 | Design system in Webflow from the theme's own tokens and breakpoints | `references/webflow-traps.md` |
| 1b | Feasibility proof on staging of the five risky assumptions | |
| 2 | CMS schema and two-pass import, media, SEO fields | `references/import.md` |
| 3 | Components and page-owned shells, measured against the reference | `references/webflow-traps.md` |
| 4 | Pages and collection templates from the composition map | `references/webflow-traps.md` |
| 5 | Behaviour bundle: menus, sliders, filters, forms, search, maps | `references/verification.md` for testing it |
| 6 | Redirects, URL manifest and checker, head tags, sitemap, structured data | `references/redirects.md`, `references/structured-data.md` |
| 7 | Verification: structure, visual, behaviour, links, content, SEO, code parity, editor acceptance | `references/verification.md` |
| 8 | Cutover: re-sync, DNS, launch checks, rollback, retirement. Always with the owner, never unattended | `references/cutover.md` |

Keep a mapping file per theme in the project (`theme-mapping.md`): each theme block, whether it became a component or a page-owned shell with a list, and why. Sites on the same theme share most of it, so the second migration starts from the first one's file.

## When the request is only one part

Most requests are a slice of the above. Go straight to the slice:

- **"Map our old redirects"** → `references/redirects.md`, `scripts/live-capture.mjs`, `scripts/build-redirects.py`, `scripts/check-urls.mjs`.
- **"Is the rebuild the same as the old site?"** → `references/verification.md`.
- **"Add schema markup"** (any Webflow site, migrated or not) → `references/structured-data.md`.
- **"Can editors add new items without breaking things?"** → `references/verification.md`, "Test a new item the way an editor makes it".
- **"Webflow refused / dropped / lost my change"** → `references/webflow-traps.md`.
- **"We're ready to switch DNS"** → `references/cutover.md`.

## Scripts

`scripts/README.md` lists each script, when to run it and what it writes. They read `site.config.json` (`--config`, `SITE_CONFIG`, or the current folder) and take the Webflow token only from the `WEBFLOW_TOKEN` environment variable. Most checks start from `scripts/staging-paths.mjs`, which lists every path the new site serves; rerun it when pages or items are added. Browser checks block common trackers and form submissions by default. Prove a checker before trusting it: a fixture with one known failure must fail.

The kit covers redirects and checking. It does **not** ship the parts that depend on the theme and the content model; write those per site, driven by the same config: the inventory generator, the importer and body converter, the media uploader, the composition map and its sequence check, the measuring and screenshot scripts, the behaviour suite, the JSON-LD generator, and the bundle build. `references/phases.md` says what each must do.

## The traps that cost the most time

Read `references/webflow-traps.md` before Phase 1. The short list:

1. Webflow's breakpoints (styles apply up to 991, 767 and 479, so layouts switch at 992, 768 and 480) are rarely all the theme's. Read the theme's real screens and measure both sides of every one.
2. Collection List settings, "current item" links and multi-image sources are partly Designer-only. Plan a short Designer pass at the end of each structure.
3. Never remove a Collection List's Empty State (the whole list is deleted silently); hide it.
4. Never build a Collection List inside a component definition by API.
5. A timed-out bulk create may still have created the items. Re-list and match on your own id field before resending.
6. Redirect and robots.txt APIs need an Enterprise plan; otherwise use the dashboard CSV import, which replaces every existing redirect.
7. `noindex` does not remove a page from Webflow's sitemap; that is a separate setting, and a Designer page-settings save resets it.
8. CMS templates print no Open Graph or Twitter tags unless you add them in template head code.
9. Items created by an editor lack importer-only fields. Anything keyed on those fields silently drops new items.
10. The old site holds redirects and behaviour the exports don't show. Capture what the live site actually does.
