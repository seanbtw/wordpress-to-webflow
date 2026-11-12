# Phases and their gates

Each phase ends with a "Done when" list. Print the list with the evidence beside each line and append it to `PROGRESS.md` before moving on. Rough effort on a 500-item, 30-page site with 24 theme blocks: about three days of continuous agent time for phases 0 to 7, most of it in Phase 2 (import and media) and Phases 3 and 4 (components and pages).

## Contents
- Decisions to settle in PLAN.md
- Phase 0: local reference and inventories
- Phase 1: design system
- Phase 1b: feasibility proof
- Phase 2: CMS and import
- Phase 3: components and shells
- Phase 4: pages and templates
- Phase 5: behaviour
- Phase 6: redirects and head
- Phase 7: verification
- Phase 8: cutover
- Running it unattended

## Decisions to settle in PLAN.md

Settle what is the owner's to decide before Phase 0. Record the technical ones as Phase 0 and Phase 1b establish them. Once a decision is recorded, do not reopen it mid-build:

- **New Webflow site**, native styles, classes, variables, components and CMS. One script file and one CSS file for what Webflow cannot do.
- **The local WordPress is the reference**, not the live site.
- **URL structure stays as WordPress has it.** CMS collection slugs equal the WordPress post-type slugs so item URLs match. List the unavoidable changes (for example Webflow reserves `/search`) and give each a redirect.
- **Breakpoints follow the theme.** Record the theme's real screens.
- **Forms**: keep the existing provider and form ids unless told otherwise.
- **Filtering**: lists over 100 items need client-side filtering over the complete dataset, with old query-string links still working.
- **Sliders and motion**: name the libraries. The theme's own options are the spec to match.
- **SEO requirements** drawn from Search Console: which pages produce the clicks (verify those first and strictest), titles and descriptions unchanged, one `h1` per page, structured data, sitemap and robots policy.
- **What is out of scope**: no new copy, no content pruning unless the owner asks.

## Phase 0: local reference, inventories, capability proof

Goal: the backup running locally exactly as the live site renders, a machine-readable inventory of everything, and proof the tools can do the job. See `wordpress-side.md` for the mechanics.

Done when
- Archive check recorded: 0 missing files, 0 size mismatches, integrity pass.
- The local site renders the home page and one page of each template correctly, and a page with a form shows it.
- `inventory/` holds posts, page block trees, bodies, options, navigation, SEO, assets, URLs and a generated `counts.md`.
- `reference/` holds screenshots at fixed widths with the capture settings written down.
- `reference/` screenshots are at 390, 768, 1200, 1440 and 1920 wide (swap in the theme's own steps if they differ).
- A README says how to start, stop, reset and refresh the local stack and how production side effects are prevented.
- Capability proof recorded: fonts confirmed by API; one variable, one style, one component with a property created, placed, published to staging and confirmed in the published HTML; which tool actions worked headless and which needed the Designer open.

## Phase 1: design system

Colours, type classes, spacing tiers, buttons, tags and containers, taken from the theme's own configuration (for a Tailwind theme, its config and compiled CSS), not from screenshots.

Done when
- A draft, noindex `Styleguide` page (excluded from sitemap and search) shows every colour, type class, button variant and state, and spacing tier beside the compiled-CSS reference, and the numbers match at each width, checked on both sides of every breakpoint.
- `PROGRESS.md` lists every value that could not be expressed natively and went into the CSS file, with the reason.

## Phase 1b: feasibility proof

Five small proofs on real content, each a draft page plus a note saying what was decided and why. Nothing in Phases 2 to 4 proceeds on an assumption the proof did not confirm.

The proofs need content before Phase 2 exists: create the one or two collections involved with a minimal schema and load a throwaway sample by hand or with a few API calls (for the filtering proof, more than 100 items of one collection). Phase 2 replaces them.

1. **Component and CMS boundary.** Build one card list with nested tags, one grouped list, one reusable section with variable children. Decide which structures are components and which are page-owned Collection Lists inside a shell.
2. **Body conversion.** Convert five real bodies (images with captions, buttons, embedded and uploaded video, mixed content) to rich text plus any structured fields; compare text, media and links automatically; look at them in the Designer and on staging.
3. **Curation.** Prove per-placement curated lists (the home page shows six chosen items in a chosen order; landing pages choose differently).
4. **Filtering past 100.** Prove a filter finds an item beyond position 100, that every view shows the same ids for the same filter, and that URL state survives reload and back/forward.
5. **Search indexing.** Enable site search, decide what is indexed, search a phrase unique to a component body after the index builds, and record how results differ from WordPress's.

Done when all five have a decision, a staging URL and a screenshot in `PROGRESS.md`.

## Phase 2: CMS schema and import

See `import.md`.

Done when
- Counts per collection and per status equal `inventory/counts.md` after the intended exclusions, shown side by side.
- The automated body comparison passes for 100% of bodies; 20 complex bodies also checked by eye.
- Every asset in the media manifest resolves at its destination (0 failures).
- Re-running the import changes nothing (0 creates, 0 updates), and a test slug change updates the same item.
- An import log records exclusions, substitutions and reconciliations.

## Phase 3: components and shells

Done when
- Every block exists per its Phase 1b decision, with an instance of each variant on a `Component Lab` page.
- Each is screenshotted at the fixed widths beside the same block cropped from the reference, within a few pixels on size, spacing, colour and type.
- No component depends on a script to look right at rest; scripts only add behaviour.

## Phase 4: pages and templates

Compose each page from a **composition map**: for every page, the ordered list of theme blocks from `inventory/pages/<slug>.json`, each with the Webflow component or shell it maps to and the values it carries. Generate it from the inventory; a second script reads each built page's component list from Webflow and compares the sequence, so section order is checked by script, not by eye.

Build one page shell (navigation, main, footer) and duplicate it. Any page not made from the shell (one created earlier for a proof, or a utility page) needs checking for all three.

Done when
- Every path in `inventory/urls.csv` resolves on staging to the right page.
- Section sequence per page equals the composition map, by script, all green.
- Full-page screenshots exist at the fixed widths with the reference capture settings.

## Phase 5: behaviour

**The bundle.** One script entry and one CSS entry, one module per behaviour (menu, each slider, filters, forms, search, maps, modal). Bundle and minify them; name the output folder by the first characters of a hash over the built files; never delete an older folder. Serve the folders from a static host with long-lived immutable caching. The site head holds one stylesheet line and the site footer one script line, both with subresource integrity hashes, so a release is two lines changing and rollback is changing them back. A small script should print those lines from the latest build. Files too large for Webflow (video, big PDFs) go to the same host under a stable path that supports Range requests. Test an unreleased build on real staging pages with `scripts/bundle-swap.mjs` before releasing it.

**The behaviour checklist.** Write `verify/behaviour.md` from the theme's own block scripts and options, one line per behaviour a visitor can trigger, and automate as many lines as possible in a suite that runs in Chromium and WebKit at phone and desktop sizes. Rerun the whole suite after every release.

Done when
- The behaviour checklist is fully ticked, each line with the width and browser it was tested in (Chromium, real Safari, iOS Safari): menus, search, forms, sliders, accordions, filters, sticky navigation, modals, maps, reduced motion, keyboard focus.
- No console errors on any page at any width. The page source shows exactly one external stylesheet and one external script of yours, plus declared dependencies.

## Phase 6: redirects, URL manifest, head

See `redirects.md` and `structured-data.md`.

Done when
- The URL checker's fixture test fails as designed, then the real run against staging reports 0 failures.
- Every legacy redirect rule has a tested outcome recorded.
- Favicons, head tags, Open Graph tags on templates, structured data, sitemap membership and robots policy are in the published output, checked by fetching it.

## Phase 7: verification

The twelve checks are in `verification.md`. The agent performs the editor-acceptance steps through the Designer or Editor and records how; the owner repeats them at review.

Done when
- The sequence check, URL checker, link crawl (both passes), console check, body comparison, glued-words check and SEO check each report zero failures, with the output in `PROGRESS.md`.
- A comparison sheet exists for every static page and template example and each has been reviewed; every remaining difference is in `verify/accepted-differences.md` with a reason.
- The behaviour checklist is ticked in real Safari and iOS Safari as well as Chromium.
- The code-parity diff has a disposition for every difference.
- Editor acceptance and the new-item test are recorded, and the test item is deleted.
- `LEARNINGS.md` is current and the scripts grep clean of site literals.
- The owner has the staging URL, the sheets and the open list.

## Phase 8: cutover

The runbook is `cutover.md`. Always with the owner present.

Done when
- The launch checks have passed on the live domain, each signed off by its owner.
- The URL checker reports zero failures against the live domain.
- The 30-day review has passed and the old hosting is retired with the owner's agreement.

## Running it unattended

A long build can run in one session that is kept going until a completion condition is met, if these hold:

- The condition names evidence: every "Done when" line shown true with output, the URL checker at zero failures, the behaviour checklist ticked, comparison sheets present. It stops at the end of Phase 7.
- After every context compaction, re-read `PLAN.md` and `PROGRESS.md` before doing anything else.
- A step that needs the owner stays open until they answer; retrying it is not progress. Work on everything else meanwhile.
- Never widen scope to pass: no deleting checks, no marking a difference accepted without a reason in an `accepted-differences.md` file, and accepted differences that lose content or behaviour need the owner's yes.
- If two agents work in the same Webflow workspace through the same account, keep their structural component work from overlapping.
