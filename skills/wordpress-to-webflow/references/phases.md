# Phases and their gates

Each phase ends with a "Done when" list. Print the list with the evidence beside each line and append it to `PROGRESS.md` before moving on. Rough effort on a 500-item, 30-page site with 24 theme blocks: about 30 hours from the first inventory to the Phase 7 hand-off, stops for the owner included, most of it in Phase 2 (import and media) and Phases 3 and 4 (components and pages). A second site on the same theme (370 items, 37 pages) took one overnight run of about eight hours with the kit and a block compiler (Phase 3). A third (about 200 items, 38 pages) took about six and a half hours, unattended. All three were signed off before the whole-page sweep existed; on the third, the sweep and its fixes added about three hours.

## Contents
- Decisions to settle in PLAN.md
- Phase 0: local reference, inventories, capability proof
- Phase 1: design system
- Phase 1b: feasibility proof
- Phase 2: CMS schema and import
- Phase 3: components and shells
- Phase 4: pages and templates
- Phase 5: behaviour
- Phase 6: redirects, URL manifest, head
- Phase 7: verification
- Phase 8: cutover
- Running it unattended

## Decisions to settle in PLAN.md

There are three kinds. **Defaults** (SKILL.md, "Decided by default") are applied and recorded without asking. **The owner's questions** (SKILL.md, "What to get from the site owner first") are asked once, before Phase 0, together with everything else on that list. **Technical ones** are recorded as Phase 0 and Phase 1b establish them. Once a decision is recorded, do not reopen it mid-build:

- **New Webflow site**, native styles, classes, variables, components and CMS. One script file and one CSS file for what Webflow cannot do.
- **The local WordPress is the reference**, not the live site.
- **URL structure stays as WordPress has it.** CMS collection slugs equal the WordPress post-type slugs so item URLs match. The changes Webflow forces are a default, not a question: a listing page whose path is also its collection's folder moves to a new slug, and Webflow's Search Results page takes `/search` once site search is used. Make only those, give each one exact redirect, and log it.
- **Breakpoints follow the theme.** Record the theme's real screens.
- **Forms**: keep the existing provider and form ids unless told otherwise.
- **Filtering**: lists over 100 items need client-side filtering over the complete dataset, with old query-string links still working.
- **Sliders and motion**: name the libraries. The theme's own options are the spec to match.
- **SEO requirements** drawn from Search Console: which pages produce the clicks (verify those first and strictest), titles and descriptions unchanged, one `h1` per page, structured data, sitemap and robots policy.
- **Search** (default): Webflow's own site search; the old results address is redirected with the query carried over.
- **Maps and other keyed services** (default): reuse the key the old site uses. Adding the staging address to the key is the owner's step and goes on the hand-off list.
- **Uploads** (default): only the files the site, a redirect or Search Console shows in use keep an address. The rest stay on the old host; record how many files and how much that is. If the owner asks for every original instead, that changes how old file URLs are redirected (`redirects.md`).
- **Site plan** (default): if the pre-flight shows the site takes the build without one, build without one. Record what waits for it: 301 redirects, real search results, sitemap controls (see Phase 0, pre-flight).
- **Old addresses with no obvious new home** (default): the nearest parent page, marked provisional and listed for the owner to confirm before cutover.
- **Oversized images** (the owner's): re-encode smaller copies or put a resizer in front of them. Until answered, images stay as uploaded and Phase 7 reports the weight.
- **Content types no published page uses** (the owner's): migrate them or not. Until answered, leave them until last.
- **What is out of scope**: no new copy, no content pruning unless the owner asks.

## Phase 0: local reference, inventories, capability proof

Goal: the backup running locally exactly as the live site renders, a machine-readable inventory of everything, and proof the tools can do the job. See `wordpress-side.md` for the mechanics.

**Pre-flight probe, first.** Before anything else, find out what this site and workspace will accept, by trying it: is the token present; does a third static page save; does a 51st CMS item save and publish; does a full publish to the staging address work; does the sitemap API answer (a 403 "plan doesn't support" is the usual first refusal); do Site settings show 301 redirects as available. Record the answers in `PLAN.md`. Do not read the limits off the pricing page: a blank site with no site plan took 15 collections, 372 items and 37 pages in one workspace, and refused only sitemap controls, 301 redirects and real search results. Delete the probe items and any probe collection afterwards.

**Two Designer steps the API cannot do.** Do them yourself through the browser at the start; they are not the owner's to do, and only a missing sign-in is a reason to park them. Both are needed before the utility pages can be built: open Pages › Utility pages › 404 once (it has no id in the page list until then), and add a Search element from the Add panel, then delete it (that creates the Search Results page). The site icon is one upload in Site settings › General › Icons: give it the largest square icon in the backup's root.

Done when
- Pre-flight answers recorded.
- Archive check recorded (`scripts/archive-check.py`): 0 missing files, 0 size mismatches, integrity pass, and every name that differs only in letter case extracted to a side folder.
- The local site renders the home page and one page of each template correctly, and a page with a form shows it.
- `inventory/` holds posts, page block trees, bodies, options, navigation, SEO, assets, URLs and a generated `counts.md`.
- `reference/` holds measurements, not pictures: for every static page and one example per template, at 390, 768, 1200, 1440 and 1920 wide (swap in the theme's own steps if they differ), the section sequence, each block's box, the computed type of its first text elements and the page height, as JSON. The same script must be able to measure staging, so both sides are read the same way. Phones are measured with a phone user agent. Screenshots may be kept beside them as a record for the reviewer; nothing is decided from them.
- A README says how to start, stop, reset and refresh the local stack and how production side effects are prevented.
- Capability proof recorded: fonts confirmed by API; one variable, one style, one component with a property created, placed, published to staging and confirmed in the published HTML; which tool actions worked headless and which needed the Designer open.

## Phase 1: design system

Colours, type classes, spacing tiers, buttons, tags and containers, taken from the theme's own configuration (for a Tailwind theme, its config and compiled CSS), not from screenshots.

Done when
- A noindex `Styleguide` page (published to staging so it can be measured, excluded from sitemap and search, set to draft before cutover) shows every colour, type class, button variant and state, and spacing tier beside the compiled-CSS reference, and the numbers match at each width, checked on both sides of every breakpoint.
- `PROGRESS.md` lists every value that could not be expressed natively and went into the CSS file, with the reason.

Generate both halves of the styleguide comparison from one list: a script that writes the WordPress twin (theme CSS plus the theme's own markup for each button, tag and type class) and the Webflow rows, with the same hooks on each, so the two sides can never drift apart. Take the class list from this site's compiled CSS.

## Phase 1b: feasibility proof

Six small proofs on real content, each on its own page (published to staging for the proof, set back to draft afterwards) plus a note saying what was decided and why. Nothing in Phases 2 to 4 proceeds on an assumption the proof did not confirm.

The proofs need content before Phase 2 exists: create the one or two collections involved with a minimal schema and load a throwaway sample by hand or with a few API calls (for the filtering proof, more than 100 items of one collection). Phase 2 replaces them.

1. **Component and CMS boundary.** Build one card list with nested tags, one grouped list, one reusable section with variable children. Decide which structures are components and which are page-owned Collection Lists inside a shell.
2. **Body conversion.** Convert five real bodies (images with captions, buttons, embedded and uploaded video, mixed content) to rich text plus any structured fields; compare text, media and links automatically; look at them in the Designer and on staging.
3. **Curation.** Prove per-placement curated lists (the home page shows six chosen items in a chosen order; landing pages choose differently).
4. **Filtering past 100.** Prove a filter finds an item beyond position 100, that every view shows the same ids for the same filter, and that URL state survives reload and back/forward.
5. **Search indexing.** Enable site search, decide what is indexed, search a phrase unique to a component body after the index builds, and record how results differ from WordPress's. On a site with no plan, search returns sample results only: build the page, and move this proof to cutover.
6. **A list of the template's own collection on a template page.** "Related items" blocks usually list the same collection the template belongs to. Build one by API, publish, and fetch an item page. If the list publishes empty (it did on one site with no plan, though the same list rendered on a clean no-plan site with 4 items and with 60, so the cause is not the plan alone), feed those blocks from the listing page by script instead, and put the data the script needs on the listing cards.

Done when all six have a decision, a staging URL and the published HTML or measurement that shows it in `PROGRESS.md`.

## Phase 2: CMS schema and import

See `import.md`.

Done when
- Counts per collection and per status equal `inventory/counts.md` after the intended exclusions, shown side by side.
- The converter's own comparison of each converted body with the WordPress-rendered one (text, media count, link set) passes for 100% of bodies before upload. The rendered comparison on staging (`scripts/compare-bodies.mjs`) needs published templates and runs from Phase 4. The 20 most complex bodies are also looked at side by side as a record for the reviewer; that look is not the check.
- Every asset in the media manifest resolves at its destination (0 failures).
- Re-running the import changes nothing (0 creates, 0 updates), and a test slug change updates the same item.
- An import log records exclusions, substitutions and reconciliations.

## Phase 3: components and shells

**Compile, don't hand-build, when the theme is made of utility classes.** For a Tailwind-style theme, write a compiler that reads the block as the local WordPress renders it, looks every utility class up in the theme's compiled CSS, folds each element's utilities into one Webflow class, keeps the design-system classes from Phase 1 as the base class, turns the theme's mobile-first steps into Webflow's desktop-first breakpoints, and sends what Webflow cannot hold (steps at widths Webflow lacks, `!important` utilities, unsupported pseudo-classes) to the site stylesheet. Hand-build only behaviour. On the second build a navigation, a footer and a hero compiled this way measured equal on 853, 2,613 and 660 values. The compiler has to know these, each found by measurement:

- Values the HTML builder's CSS mangles (the style tool keeps them): `unset` is dropped without an error (write the real initial value); a one-value `grid-column` or `grid-row` stores only the start (write both longhands); an inline custom property the theme sets on an element must be substituted before compiling (fail the compile on an empty `repeat(,`); a custom property in class CSS becomes one site-wide variable, so write the resolved value.
- An `!important` utility must keep winning over a later plain value (`!hidden` then `inline-flex` from a component class).
- A transform that only applies from a breakpoint up must not be folded into the base class: compose the translate parts per breakpoint, and flag any base `transform` that came from a breakpoint class.
- Layout that the utility classes do not show: WordPress core block CSS (columns), block-scoped theme rules, and padding a script adds to `main`. Compile all three.
- Theme buttons and spacers should compile to the Phase 1 components, not to inline markup: compound rules (an icon circle on a button with an icon) are lost otherwise.
- Empty paragraphs are dropped by a naive compile but hold a margin on WordPress; measure and carry the gap (and see `import.md` for the no-break-space case).
- A block compiled on its own loses rules scoped to an ancestor (a width that differs inside the page container). Compile each block in its real page context (`wordpress-side.md`).
- Scan the compiled CSS for `unset` and `initial` before every insert; it is the fault that returns most often.
- A trailing space inside an inline element is dropped by the HTML builder, and a `<button>` with child spans has come out as placeholder text on two builds though not on a clean site (`webflow-traps.md`, "Building elements"): mend the space after the insert or move it outside the element, compile such buttons to a div with a button role, and fail the build on any placeholder in the published HTML.
- On templates and list cards, the compiler must mark every block, heading and list that will take a CMS binding, so those are created with the element builder and the rest goes in as HTML (an HTML-built paragraph, span or link takes a binding). A binding on an HTML-built block, heading or list inside a list item is dropped or refused (`webflow-traps.md`, "Write conflicts").
- **Never fold the framework's base reset into a class that also styles the element's type.** A utility framework resets buttons at its base layer (`line-height: inherit`, `color: inherit`); written into the element's own combo class, the reset beats the type class (menu items at line-height 1.5 for 1.1, twelve filter buttons). Leave reset properties off any element that carries a type class, and keep one source of truth per property, not the Webflow class and the bundle stylesheet both.
- **Resolve utilities in the stylesheet's rule order, not the order they sit in the class attribute.** With `transition-all` and `duration-500` on one element, the later rule in the stylesheet wins whichever is written first.
- **A utility with no breakpoint prefix belongs at the base, at every size.** One written only at the phone breakpoint cost a menu 40 px of padding at the tablet width.
- **Parent-hover utilities (`group-hover:`) cannot be a Webflow class.** Translate each into a stylesheet rule (`.parent:hover .child`) and list them in the compile report.
- **When a plugin prints an inline style, bring the plugin's own rule for the children with it**, or drop the inline value. A share plugin's 32 px line-height on the wrapper, without its 16 px reset on the links, made the menu 214 px tall for 150.
- **Drop static markup that a script rebuilds**, from a register of the widgets scripts own.
- **Webflow's own element classes beat the theme's reset.** `.w-button { border: 0 }` removed every compiled 1 px border on link-buttons. For each Webflow class the build emits (`w-button`, `w-inline-block`, `w-richtext`), list what it sets and restore the theme's value after it in the base stylesheet.
- **When an element changes type, carry what the old type did for free.** A disabled `<button>` that becomes a link keeps its hand cursor and Tab stop unless told otherwise; a div with a button role needs the pointer cursor; a slider that took focus and answered the arrow keys must still do so.
- A carousel captured from the rendered page compiles to a still (absolutely placed slides, fixed heights from the capture width) unless its track gets the script hook. After each page insert, grep the published HTML for the slider library's own class names on elements with no hook.
- A compiler that names classes by their style signature hands back the first prefix's names when a block is recompiled under a new prefix. Give it an option to start a prefix afresh, used only when the old names were never created in Webflow.
- Give each page its own class namespace, numbered in document order. The HTML builder reuses an existing style with the same class name and ignores the new CSS for it; when a page is patched rather than re-inserted, push changed rules as style updates.
- The traps in `webflow-traps.md`, "Building elements".

Done when
- Every block exists per its Phase 1b decision, with an instance of each variant on a `Component Lab` page.
- Each is measured at the fixed widths against the same block on the local WordPress (`scripts/measure-blocks.mjs`): boxes within 2 px; type, colour, background and border equal; zero mismatches or each one explained.
- No component depends on a script to look right at rest; scripts only add behaviour.

## Phase 4: pages and templates

Compose each page from a **composition map**: for every page, the ordered list of theme blocks from `inventory/pages/<slug>.json`, each with the Webflow component or shell it maps to and the values it carries. Generate it from the inventory; a second script reads each built page's component list from Webflow and compares the sequence, so section order is checked by script, not by eye.

Build one page shell (navigation, main, footer) and duplicate it. Any page not made from the shell (one created earlier for a proof, or a utility page) needs checking for all three. Give every collection template at least the navigation and footer, including collections whose WordPress pages render but are empty: a template with nothing in it makes every item address answer "not found". Where WordPress itself answers "not found" for every item of a type, that is the tool to use: leave the template empty on purpose.

**Measure whole templates, and crawl early.** A template's measurement spec takes the template's whole content wrapper, not the one block that was just built. On the second build a case-study template was measured on its meta block only, and three sections present on every WordPress item were missing until the last day. Run `scripts/heading-sequence.mjs` over every path as soon as templates exist, and again after each template change. **Then sweep every page**: `scripts/page-sweep.mjs --all` compares every page and every item with WordPress, whole, at three widths, and groups what differs by cause (`verification.md`, "The whole-page sweep"). A template example proves one item; the sweep is what proves the other hundred. It is part of this phase, not a favour to the owner at the end.

List every block the theme shows or hides by device (decided on the server from the user agent, not from the width) and build both versions, with a small early script that marks the page for phones and tablets and CSS that shows the right one.

Done when
- Every path in `inventory/urls.csv` resolves on staging to the right page.
- Section sequence per page equals the composition map, by script, all green.
- The heading-order crawl reports every page's headings equal to WordPress. One `h1` per page is the target: where WordPress prints several, the first stays the `h1` and the change is listed; where it prints none, adding one is new wording and waits for the owner.
- Every template example is measured whole at the fixed widths.
- The whole-page sweep has run over every path (the count of page loads compared is in `PROGRESS.md`), and its triage is empty or every row left is explained.

## Phase 5: behaviour

**The bundle.** One script entry and one CSS entry, one module per behaviour (menu, each slider, filters, forms, search, maps, modal). Bundle and minify them; name the output folder by the first characters of a hash over the built files; never delete an older folder. Serve the folders from a static host with long-lived immutable caching. The site head holds one stylesheet line and the site footer one script line, both with subresource integrity hashes, so a release is two lines changing and rollback is changing them back. A small script should print those lines from the latest build. Files too large for Webflow (video, big PDFs) go to the same host under a stable path that supports Range requests. Test an unreleased build on real staging pages with `scripts/bundle-swap.mjs` before releasing it. If the static host's deploy tool can see more than one account, it refuses to choose when run without a terminal: put the account id in the config and pass it in the environment (for Cloudflare Pages, `CLOUDFLARE_ACCOUNT_ID`; a new Pages project also needs creating once before its first deploy).

**Three rules for modules.** Each module carries its own CSS beside its script, so porting one ports the other (two were ported without, and a drawer and two maps reached review unstyled). Modules find elements by a data hook, never by tag name, since the compiler may change the tag, and fall back sensibly when one hook is missing. Every overlay (menu, drawer, filter drawer) uses one shared lock for the page behind it.

**The behaviour checklist.** Write `verify/behaviour.md` from the theme's own block scripts and options, one line per behaviour a visitor can trigger, and automate as many lines as possible in a suite that runs in Chromium and WebKit at phone and desktop sizes. Rerun the whole suite after every release.

Done when
- The behaviour checklist is fully ticked, each line with the width and browser it was tested in (Chromium, real Safari, iOS Safari): menus, search, forms, sliders, accordions, filters, sticky navigation, modals, maps, reduced motion, keyboard focus.
- Every open state is measured against WordPress at phone, tablet and desktop; hover, focus, Enter and Space, a slow drag on every slider and scrolling beside every overlay are compared on both sides (`verification.md`, "States the sweep cannot see").
- No console errors on any page at any width (`scripts/console-check.mjs --all`; without the flag it loads every static page and one item of each collection). The page source shows exactly one external stylesheet and one external script of yours, plus declared dependencies.

## Phase 6: redirects, URL manifest, head

See `redirects.md` and `structured-data.md`.

Pull the Search Console pages before building the redirect file, not after: they are the list's real test (see `redirects.md`).

On a site with no site plan, 301 redirects cannot be imported at all. Build and check the import file offline, record that, and move the import and the checker's redirect rows to cutover; the checker still runs now for every URL that should answer 200.

Done when
- The URL checker's fixture test fails as designed, then the real run against staging reports 0 failures (redirect rows excepted on a site with no plan, and listed as waiting).
- Every legacy redirect rule has a tested outcome recorded.
- Favicons, head tags, Open Graph tags on templates, structured data, sitemap membership and robots policy are in the published output, checked by fetching it. For the Open Graph image that means every item of every template compared with WordPress's picture, not one page read for the tag.

## Phase 7: verification

The twelve checks are in `verification.md`. The agent performs the editor-acceptance steps through the Designer or Editor and records how; the owner repeats them at review.

Done when
- The sequence check, URL checker, link crawl (both passes), console check, body comparison, glued-words check and SEO check each report zero failures, with the output in `PROGRESS.md`.
- A measurement report exists for every static page and template example at the fixed widths, with zero mismatches or every remaining difference in `verify/accepted-differences.md` with a reason.
- The whole-page sweep (`scripts/page-sweep.mjs --all`) has compared every path at phone, tablet and desktop widths after the last release: its triage is empty, or every row left is in `verify/accepted-differences.md` with a reason. "Compared N of N page loads" is quoted in `PROGRESS.md`.
- The behaviour checklist is ticked in real Safari and iOS Safari as well as Chromium, rerun in full after the last release.
- The states the sweep cannot see are measured, and the structure checks pass on every page (`verification.md`, the two sections after the sweep).
- Every part the last sweep still lists is in a named group, with counts that add up to the total.
- The code-parity diff has a disposition for every difference.
- Editor acceptance and the new-item test are recorded, and the test item is deleted.
- `LEARNINGS.md` is current and the scripts grep clean of site literals.
- The owner has the staging URL, the reports and the open list.

## Phase 8: cutover

The runbook is `cutover.md`. Always with the owner present.

Done when
- The launch checks have passed on the live domain, each signed off by its owner.
- The URL checker reports zero failures against the live domain.
- The 30-day review has passed and the old hosting is retired with the owner's agreement.

## Running it unattended

A long build can run in one session that is kept going until a completion condition is met, if these hold:

- The condition names evidence: every "Done when" line shown true with output, the URL checker at zero failures, the whole-page sweep clean over every path, the behaviour checklist ticked, measurement reports present. It stops at the end of Phase 7.
- **When a prerequisite is missing, park it and keep going**, in this order: everything local first (Phase 0, inventories, reference measurements); then whatever the pre-flight showed the site accepts; then the offline halves of plan-dependent work (the redirect file, the search page layout). Keep one list of what is parked and what each item is waiting for, and put it at the top of every report.
- **The owner is asked once, before the run**, for what SKILL.md's owner list holds. Nothing else is asked during the run: a choice that turns up on the way (a fault of the old site to copy or not, a default the owner may want changed) gets the default, goes on the waiting list, and is put to the owner at review. Defaults are applied and reported, not asked. A Designer-only step is done through the browser; if the browser is not signed in, the parked item is the sign-in, not the step.
- After every context compaction, re-read `PLAN.md` and `PROGRESS.md` before doing anything else.
- A step that needs the owner stays open until they answer; retrying it is not progress. Work on everything else meanwhile.
- Never widen scope to pass: no deleting checks, no marking a difference accepted without a reason in an `accepted-differences.md` file, and accepted differences that lose content or behaviour need the owner's yes.
- Structural work in a Webflow workspace belongs to one agent at a time (`webflow-traps.md`, "Write conflicts"). If a second agent must work in the same workspace through the same account, give it content or checks, never components or page structure.
- **Idle is not stalled.** A build waiting on its own background agents looks idle from outside; a watchdog should read the progress file and the list of running agents before nudging it.
- **Log to absolute paths.** A shell script that changes folder part-way and then logs to a relative path skips every later step without a word (the shell does not run a command whose redirect fails).
- **End with an outside check** by a session that did not do the build (`verification.md`, "A check that did not run looks like a pass").
