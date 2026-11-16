---
name: wordpress-to-webflow
description: Rebuild a WordPress site in Webflow so it looks and behaves the same, keeps every URL that matters, and stays editable by the site's own team. Use this whenever someone wants to move, migrate, rebuild or recreate a WordPress site (WP Engine, ACF, Yoast, custom themes, page builders) in Webflow, import WordPress content into Webflow CMS, turn WordPress or host redirect rules into Webflow 301s, check a Webflow rebuild against the old site, add JSON-LD schema markup to a Webflow site, test that editors can add new CMS items, or plan the DNS cutover. Use it even when they ask about only one of those steps, and when they hit a Webflow API or MCP limit (Collection Lists, components, slots, redirects, sitemap) during any Webflow build.
---

# WordPress to Webflow

A method for rebuilding a WordPress site in Webflow, written from a full migration (about 500 CMS items, 30 pages, 24 theme blocks), three follow-up schema jobs, a second site on the same theme (about 370 items, 37 pages) built with this kit in one overnight run, and a third (about 200 items, 38 pages) built unattended in about six and a half hours. It exists because the obvious way fails: rebuilding pages by eye from the live site gets the colours right and nearly everything else subtly wrong (breakpoints, spacing tiers, which element carries which rule, behaviour, URLs). The method below replaces looking with measuring.

## The method in five sentences

1. **Build from source, not by eye.** The WordPress theme and database are the specification. Run the backup locally and treat that copy as the reference for every comparison.
2. **Inventory before building.** Every page, post, field, option, asset, URL and SEO value goes into machine-readable files, and the acceptance counts are generated from them, never typed.
3. **Prove the risky parts small.** Settle component versus Collection List boundaries, body conversion, curation, filtering past 100 items, search, and a list of the template's own collection on a handful of real examples before building at scale.
4. **Import idempotently.** Identity is the WordPress id, not the slug, so the import can be rerun at cutover without duplicates.
5. **Verify by script, with evidence.** Differences are found by comparing code and measured values (computed styles, box sizes, heading order, text and link sets), never by comparing pictures. A claim without output (counts, command results, measured values, file paths) does not count as done. **And nothing is checked by sample alone**: every page and every item is compared with WordPress, whole, by the whole-page sweep (`scripts/page-sweep.mjs --all`), from the first published template onward. The owner should never be the one who finds a visible difference.

## What this assumes you have

- **The Webflow MCP server** connected, with its Designer companion ("MCP Bridge") app. Most building is done through it; `references/webflow-traps.md` names the tools. Calls that work with no Designer tab open are called *headless* here; some need the Designer open on the site with the Bridge launched.
- **A browser you can drive** for the few Designer-only steps, signed in by the owner. The steps themselves are yours to do, not the owner's (see "Decided by default").
- **Docker**, Node 20.18.1 or later, Python 3.9 or later, and Playwright for the local reference and the checks.
- **The Webflow Data API v2** with a site token, for bulk CMS work.

## What to get from the site owner first

These are the steps only a person can do. Ask for all of them at the start, saying where each is done, then carry on with everything that does not depend on them.

| Needed | Where the owner does it | Why |
|---|---|---|
| A new, empty Webflow site and its site id. A site plan is needed by cutover (hosting, 301 redirects, real search results, sitemap controls); whether one is needed to *build* depends on the workspace, so run the Phase 0 pre-flight probe instead of assuming | Webflow dashboard | Never resume a half-built earlier attempt; keep it as a reference only |
| A site API token with CMS, Sites and Pages scopes, saved as `WEBFLOW_TOKEN=` in a local `.env` | Site settings › Apps & integrations › API access | Bulk import. Never printed, logged or pasted in chat. Site head and footer code needs a further scope, or is written through the MCP. Asset uploads work through the MCP, so no assets scope is needed |
| A full backup of the WordPress site: files plus database dump | The host's backup tool | The local reference |
| The host's redirect rules export | The host's redirect settings | Redirects often live at the host, outside WordPress |
| Read access to Search Console and analytics for a service account, if available | Search Console › Settings › Users and permissions | Which URLs and pages matter; the SEO baseline |
| Brand fonts uploaded to the Webflow site | Site settings › Fonts | Fonts cannot be guessed |
| The staging host (`<short-name>.webflow.io/*`) added to any referrer-restricted API key, such as maps | The key's settings in its cloud console | Otherwise maps fail on staging. Can wait until review: it holds nothing else up |
| A test-contact procedure for any live form or CRM provider | Agreed with whoever owns the CRM | No test submission before it exists |
| How oversized images are to be slimmed (re-encode smaller copies, or put a resizer in front of them) | A decision; can wait until Phase 7 | It changes what visitors download. Until answered, images stay as uploaded and the weight is reported (a file over Webflow's upload limit has to be re-encoded to go up at all: `references/import.md`) |
| Whether content types that no published page uses are migrated | A decision, before Phase 2 ends | It decides what content survives the move. Until answered, leave those types until last and say so |

If something on this list is missing when the build starts, do not stop: park it, say so, and carry on with what does not depend on it. `references/phases.md` ("Running it unattended") gives the order.

## Decided by default

Do not ask the owner about these. Apply the default, record it in `PLAN.md` marked "default", and list the defaults in the first report so the owner can overturn one. An instruction from the owner always wins.

| Question | Default |
|---|---|
| Is a site plan needed to build? | Run the Phase 0 pre-flight probe. If the site takes the pages and items without a plan, build without one and keep a single list of what waits for it (301 redirects, real search results, sitemap controls) |
| Do old upload files keep their addresses? | Only the files the site, a redirect or Search Console shows in use. The rest stay where they are on the old host; report how many files and how much that is (`references/redirects.md`) |
| Addresses Webflow forces to change | Change only those (a listing page whose path is also its collection's folder, the reserved `/search`), give each one exact redirect, and log it |
| Search | Webflow's own site search, with the old results address redirected and the query carried over where the old address has a path of its own (WordPress's default `/?s=` cannot be matched by any redirect) |
| Maps and other keyed services | Reuse the key the old site uses. The owner's one step (the staging address added to the key) goes on the hand-off list |
| Designer-only steps | Do them yourself through the browser: open the Designer and launch the Bridge app, open the 404 page once, add and delete a Search element, upload the site icon, set a "current item" link or a multi-image source. They never go on the owner's list; only a missing sign-in does |
| An old address with no obvious new home | Redirect it to the nearest parent page, mark the row provisional, and list it for the owner to confirm before cutover |

**Standing answers.** An owner with several sites answers some things once for all of them: house wording, which fonts are licensed, the form provider's account, hard limits on what may be touched. If the brief or the project folder names a standing-answers file, read it before Phase 0, copy what applies into `PLAN.md`, and do not ask those again. Keep that file out of any public repository.

## Working rules

- **Never write, reword or invent copy.** Every word on the new site comes from the old one. If the source is missing something, leave it out and say so. This applies to structured data too: every string comes from a page, a CMS field or an official register.
- **Keep four files in the project folder** and read them at the start of every session and after every context compaction: `PLAN.md` (decisions and phase gates), `PROGRESS.md` (dated log: what was done, the evidence, what is open), `LEARNINGS.md` (one dated entry per discovery), `site.config.json` (every site-specific value; copy `assets/site.config.example.json`). Scripts read the config, so nothing site-specific is hard-coded and the work carries to the next site.
- **Read every write back.** Webflow's API answers "success" for writes it then drops: a class with no style behind it, a binding on some elements, a style value it does not understand. Follow each class, binding and settings write with a read of what was stored, and check the published HTML for what a read cannot show.
- **Tools take their origins from the config.** The local copy is the reference; a hand-typed live URL in a quick check sends requests to the production site. Read the origin from `site.config.json` in one-off shell checks too.
- **Within any one structure, API writes first and Designer steps last.** Once the Designer has edited inside an API-built structure, the API may refuse further writes to it. After any structural change to components, slots or lists, do one throwaway attribute write (a canary) and stop at the first failure. Take a named manual backup before risky component work.
- **Work on the staging address only.** Publishing to a live domain is the owner's decision each time. Once the live domain is on Webflow, prove what a publish would ship before asking (see `references/structured-data.md`, "Publishing safely").
- **Behaviour lives in one script file and one CSS file**, served from immutable hashed paths so rollback is changing two lines back (see `references/phases.md`, Phase 5). Custom-code fields hold only the two lines that load that release, meta and Open Graph tags, JSON-LD, a tiny early inline script where unavoidable, and third-party loaders gated to the live hostname. No behaviour code is pasted into pages.
- **Secrets stay out of chat and out of the repository.** The Webflow token is kept in a local `.env` that the shell loads into the environment; the scripts read `WEBFLOW_TOKEN` from the environment and never from a file. A service-account key is read from disk by the script that needs it. Neither is echoed, logged or committed. The live site's credentials are used nowhere in the local copy.
- **Report plainly at each phase boundary**: the phase's "Done when" list with the evidence beside each line.

## Phases

Each phase has a gate. Do not start the next until the gate's evidence is in `PROGRESS.md`. The steps and the "Done when" list for every phase are in `references/phases.md`.

| Phase | What | Also read |
|---|---|---|
| 0 | Pre-flight probe, local WordPress from the backup, inventories, reference measurements, proof the tools work | `references/wordpress-side.md` |
| 1 | Design system in Webflow from the theme's own tokens and breakpoints | `references/webflow-traps.md` |
| 1b | Feasibility proof on staging of the six risky assumptions | |
| 2 | CMS schema and two-pass import, media, SEO fields | `references/import.md` |
| 3 | Components and page-owned shells, compiled from the rendered theme where that is possible, measured against the reference | `references/webflow-traps.md`, `references/verification.md` |
| 4 | Pages and collection templates from the composition map; the heading-order crawl runs as soon as templates exist | `references/webflow-traps.md` |
| 5 | Behaviour bundle: menus, sliders, filters, forms, search, maps | `references/verification.md` for testing it |
| 6 | Redirects, URL manifest and checker, head tags, sitemap, structured data | `references/redirects.md`, `references/structured-data.md` |
| 7 | Verification: structure, measured layout, behaviour, links, content, SEO, code parity, editor acceptance | `references/verification.md` |
| 8 | Cutover: re-sync, DNS, launch checks, rollback, retirement. Always with the owner, never unattended | `references/cutover.md` |

Keep a mapping file per theme in the project (`theme-mapping.md`): each theme block, whether it became a component or a page-owned shell with a list, and why. Sites on the same theme share most of it, so the second migration starts from the first one's file. `references/example-theme-mapping.md` is the one from the reference migration, as a model.

## A second site on the same theme

The kit from the first build saves most of the early work (Phase 0 took 25 minutes against an hour, and the button component carried straight over), but only if you find out how alike the two sites really are before reusing anything:

1. **Diff the two theme folders** (leaving out vendor, build output and `node_modules`) and read every file that differs before reusing a component design.
2. **Diff the compiled rules for buttons, tags and type** between the two themes' built CSS. Differences in shared partials (a new margin on a button label, one more colour variant, another line height) do not show up as a differing template.
3. **Copy the class list from this site's compiled CSS**, not from the last site's Webflow styles. Type scales, weights and letter-spacing are per site even when the block list is identical.
4. **Before running any copied script, grep it for the previous project's folder path, domain, local port and Webflow ids** (site id, page ids, collection ids). Output paths must come from the config or be relative to the project; a copied script that still points at the last project writes into it without complaint, and one that still holds the last site's id writes to that site. On the third build several copied scripts still carried the first site's id. Move one-off scripts out of the kit before copying it, and make the rest read every host and id from `site.config.json`.
5. Record what the second build teaches in its own `LEARNINGS.md` under the same headings as the first, so the differences are easy to read side by side.

## When the request is only one part

Most requests are a slice of the above. Go straight to the slice:

- **"Map our old redirects"** → `references/redirects.md`, `scripts/live-capture.mjs`, `scripts/build-redirects.py`, `scripts/check-urls.mjs`.
- **"Is the rebuild the same as the old site?"** → `references/verification.md`.
- **"Add schema markup"** (any Webflow site, migrated or not) → `references/structured-data.md`.
- **"Can editors add new items without breaking things?"** → `references/verification.md`, "Test a new item the way an editor makes it".
- **"Webflow refused / dropped / lost my change"** → `references/webflow-traps.md`. To report it to Webflow, see its last section, "Reporting a fault to Webflow".
- **"We're ready to switch DNS"** → `references/cutover.md`.

## Scripts

`scripts/README.md` lists each script, when to run it and what it writes. All but `archive-check.py` read `site.config.json` (`--config`, `SITE_CONFIG`, or the current folder) and take the Webflow token only from the `WEBFLOW_TOKEN` environment variable. Most checks start from `scripts/staging-paths.mjs`, which lists every path the new site serves; rerun it when pages or items are added. No browser check ever submits a form; all but the console and link checks also block common trackers (those two must see the page as a visitor's browser loads it). `bundle-swap.mjs` hands back a bare browser context for your own test: add the guard to it. Prove a checker before trusting it: a fixture with one known failure must fail. Run `glued-words.mjs --rendered` straight after the first page insert, not only in Phase 7. Several scripts are for the build itself, not only the end: `archive-check.py` (is the unpacked backup complete), `measure-blocks.mjs` (is this block the same as the theme's, by measured values), `heading-sequence.mjs` (does every page have the sections the old one has), `glued-words.mjs` (after the first page insert) and `page-sweep.mjs` (every page against the old one, from the first published template).

The kit covers redirects and checking. It does **not** ship the parts that depend on the theme and the content model; write those per site, driven by the same config: the inventory generator, the importer and body converter, the media uploader, the block compiler (for a utility-class theme; see `references/phases.md`, Phase 3), the composition map and its sequence check, the reference-measurement script, the behaviour suite, the JSON-LD generator, and the bundle build. `references/phases.md`, `references/import.md` and `references/structured-data.md` say what each must do.

## The traps that cost the most time

Read `references/webflow-traps.md` before Phase 1. The short list:

1. Webflow's breakpoints (styles apply up to 991, 767 and 479, so layouts switch at 992, 768 and 480) are rarely all the theme's. Read the theme's real screens and measure both sides of every one.
2. "Current item" links and multi-image sources are Designer-only; a Collection List's source, sort, filters and limit store by API on a clean list. Plan a short Designer pass at the end of each structure for the first two.
3. Never remove a Collection List's Empty State (the whole list is deleted silently); hide it.
4. Never remove a Collection List's Empty State: the whole list goes with it, and the answer says only "Element removed". (A list built by API inside a component definition does survive when its Empty State is left alone.)
5. A timed-out bulk create may still have created the items. Re-list and match on your own id field before resending.
6. Redirect and robots.txt APIs need an Enterprise plan; otherwise use the dashboard CSV import, which replaces every existing redirect.
7. `noindex` does not remove a page from Webflow's sitemap; that is a separate setting, and a Designer page-settings save resets it.
8. CMS templates print no Open Graph or Twitter tags unless you add them in template head code.
9. Items created by an editor lack importer-only fields. Anything keyed on those fields silently drops new items.
10. The old site holds redirects and behaviour the exports don't show. Capture what the live site actually does.
11. The API reports success for writes it did not store: classes without a style, bindings on some HTML-built elements, a sort on a list that was switched to hand-picked and back, and, in the HTML builder's CSS, `unset` values and one-value grid shorthands. Read back, then measure. Name the tool when you record such a fault: the style tool keeps values the HTML builder drops.
12. A site with no site plan builds and publishes to staging, but refuses 301 redirects and sitemap controls and shows only sample search results. Those checks move to cutover.
13. A block measured in part hides what is missing from the rest. Measure whole templates, and crawl every page's heading order early.
14. A check that compared nothing reports no failures. Make every check print what it compared, and have a session that did not do the build check the result against pages saved from the live site (`references/verification.md`).
15. The HTML builder damages text three ways: it drops a space at the end of an inline element (glued words), has turned a button with inner spans into placeholder text on two builds (not reproduced on a clean site, so grep for it), and leaves off any class with no style. Check for all three straight after the first page insert.
16. Any block, heading or list that will carry a CMS binding is made with the element builder. On those, inserted with the HTML builder inside a list item, a binding is dropped or refused with the "component map" conflict; an HTML-built paragraph, span or link keeps a visibility binding, and a link a text binding (a span has no text to bind). And never switch a Collection List to hand-picked and back: its sort stops saving.
17. An item's address is the one WordPress serves. A permalink plugin can set it for any post type, so read it from the served URL list, never from the post's own slug.
18. Samples pass while pages differ. Twenty-seven measured specs were signed off on a site where a sweep of every page then found the same few faults on dozens of items. Sweep every page from Phase 4 on, and treat its triage as the gate (`references/verification.md`, "The whole-page sweep").
19. A page at rest is not the whole page. Measure every menu, drawer and panel open; compare hover, focus, Enter, Space and a slow drag on both sides; and grep every published page for missing shells, missing hooks, doubled widgets and converter placeholders (`references/verification.md`, the two sections after the sweep).
20. The old site's own faults are not targets. Record them and give the owner the list; do not copy them.
