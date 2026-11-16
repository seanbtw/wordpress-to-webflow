# Verification

The aim: no difference a user would notice, no URL lost, no behaviour missing, and proof of each. Verify the pages that produce the traffic first and strictest (Search Console tells you which).

## Contents
- Measuring
- The whole-page sweep: no samples
- The Phase 7 checks
- Code parity: the check that finds what the others miss
- A check that did not run looks like a pass
- Test a new item the way an editor makes it
- Noise to recognise
- Browser testing gotchas
- Accepted differences

## Measuring

**Differences are found by measuring and by comparing code, never by comparing pictures.** A picture comparison says that something differs and not what; it passes a wrong value that happens to look close, and it cannot be rerun as a test. The measurements are: computed styles and boxes per element (`scripts/measure-blocks.mjs`), the order of sections and headings per page (`scripts/heading-sequence.mjs`), text, link and media sets (`scripts/compare-bodies.mjs`, `scripts/crawl-links.mjs`), and head tags (`scripts/seo-check.mjs`, `scripts/code-parity.py`). Screenshots may be kept as a record for the person reviewing. A picture has one working use: to find *where* to measure. The whole-page sweep (next section) lays two parts over each other to locate the places that differ, then reports the measured values at each place; the picture is never the verdict.

- **Measure against the local WordPress at the same width, both sides of every breakpoint**: 390, 479/480, 767/768, 991/992, each of the theme's further steps and the pixel below it (for example 1199/1200), 1440 and 1920. This caught wrong breakpoints, missing steps, a line-height coming from an inline span, a slider overriding widths, clamp and paragraph sizes, tag padding and button geometry.
- **Use the theme's own numbers** (compiled CSS, block options) as the expected values, and the browser's computed values on both sites as the measurement.
- **Force lazy images eager and decoded** before measuring or capturing.
- **Keep block order equal to the reference page's** when measuring a block in isolation; some theme behaviour depends on neighbours.
- **Measure every element that has its own text, media, a background, a background image or a border**, paired by position in document order. A walk that only looks at text passed an icon button with the wrong background. Walk through zero-size wrappers (`<picture>`, an inline link): their children are visible.
- **Scroll instantly.** Themes set `scroll-behavior: smooth`; a block scrolled into view smoothly is still moving when its boxes are read.
- **Cache-bust the Webflow side only.** A query parameter on the WordPress side can change the page (a listing that reads every parameter as a filter).
- **Count a button as one item on both sides.** A theme button is one element; its Webflow replacement may be a link plus a label span, which shifts every later pairing. Treat anything pill-shaped, and whatever `checks.measure.oneItemSelector` names, as one item: its box, its label's type and its colours.
- **Measure phones with a phone user agent** as well as a phone width, for themes that choose markup on the server.
- **Measure whole templates.** Give the measurement the template's whole content wrapper. A template measured on one block looked finished while three sections were missing from every item.
- **A large mismatch count after a small change is usually one shifted pairing**, not thousands of faults (82,945 checks gave 26,568 mismatches after one element lost its box to `display: contents`). Fix the first mismatch and rerun before reading the rest.

## The whole-page sweep: no samples

**Every page and every item is compared with WordPress, whole, at phone, tablet and desktop widths. This is a required step, not something to run when someone asks.** `scripts/page-sweep.mjs --all` does it: it splits each page into its parts (the direct children of the main content wrapper, then the footer), pairs them in order, and for each pair reports a part missing or extra, a different height, and the measured values that differ under each place the two parts do not match (tag, font, size, weight, line height, colour, padding, margin, border, gap, display). `triage.md` then groups every difference by cause, the staging element and the property, by the number of pages it shows on, so one fix clears one row.

Why it is required. Block specs prove the blocks they name, and a template example proves that one item. On the third build 27 specs were measured (45,708 checks at the phone width alone), every mismatch was explained, Phase 7 was signed off, and the owner then found differences by looking at pages. The first sweep, two thirds of the way through the site, had 375 of 863 parts differing, most of them the same few causes repeated across dozens of item pages: article bodies whose size, weight, colour and paragraph spacing no spec had measured, a related-items grid, image wrappers. The two earlier builds were signed off the same way and had never been swept. **A sample is a check that did not run on the rest.**

- **Run it as soon as the first template is published** (Phase 4), again after every release of scripts or styles, and as a Phase 7 gate. Early, it costs minutes and finds a cause once; late, the same cause is on every item.
- **Read `triage.md` from the top.** Fix the cause on the most pages, rerun, and only then read on: later rows are often the same fault seen from a parent element or a shifted neighbour.
- **Fix missing and extra parts first.** Parts are paired by order, so one part missing on staging shifts every pair after it on that page.
- **The first run is loud.** That is the point; do not raise the threshold to quieten it. A row that is truly not a fault (text that wraps one word differently, a third-party embed that draws itself) goes in `accepted-differences.md` with its reason.
- **It compares pages at rest.** Hover and focus states, open menus and panels, sliders part-way through and anything behind a click are not in it; those belong to the behaviour checklist, which should measure the opened state the same way.
- **It needs the local WordPress copy running and every staging path in `staging-paths.json`**; rerun `staging-paths.mjs` after publishing new items, and read the line that says how many page loads were compared.

## The Phase 7 checks

1. **Structure**: component sequence per page equals the composition map, by script. The script must read the marker *this* build writes on each block (a data attribute, or the compiled class name). One written for another build's markers finds nothing and never truly runs; print how many pages and blocks it compared.
2. **Measured layout**: every static page and template example measured whole against the local WordPress at 390, 768, 1200, 1440 and 1920 and both sides of each breakpoint, plus each fixed or sticky layout at a defined scroll position; the heading-order crawl over every path. **Triage by page height difference first** (lost or added content), then by the first mismatch on each page. Zero mismatches, or each one in the accepted-differences file. **Then the whole-page sweep over every path** (`scripts/page-sweep.mjs --all`, section above): its triage empty, or every row left in the accepted-differences file. The specs alone do not pass this check.
3. **Behaviour and accessibility**: the behaviour checklist, every line ticked with width and browser, including real Safari and iOS Safari. Menus, search, forms, sliders, accordions, filters, sticky elements, modals, maps, keyboard focus, reduced motion. **Every script-driven element on the WordPress page must map to a hook on the new page**: list the theme's own markers (an Alpine `x-data`, a slider library's classes) per page and confirm each has its module hook in the published HTML. A block with no hook compiles to markup that looks right and does nothing (a page menu that should stick, a share bar, tabs, a header search form).
4. **Console**: no errors on any page at any width (`scripts/console-check.mjs`).
5. **Links and media**: crawl staging (`scripts/crawl-links.mjs`): zero broken internal links; zero references to the old host or to localhost in HTML, `srcset`, CSS backgrounds, embeds or JSON-LD; then crawl again with requests to the old host blocked and confirm nothing visible breaks.
6. **URLs**: `scripts/check-urls.mjs` at zero failures.
7. **Content**: automated body comparison at 100% (`scripts/compare-bodies.mjs`), `scripts/glued-words.mjs --rendered` over every page, plus side-by-side spot checks of a sample of each type. Any page whose markup an agent typed out by hand, not a compiler, gets a word-by-word comparison of its visible text with WordPress (same words, same order) before it is measured.
8. **SEO** (`scripts/seo-check.mjs`): exactly one `h1`; title and description equal the inventory; JSON-LD parses and validates; the Open Graph image on **every** page and item is the picture WordPress prints there (none where WordPress prints none); sitemap lists what it should and nothing else. **Alt text**: compare per page by placement in the served HTML, keyed by file (strip WordPress size suffixes, `-scaled` and Webflow's asset-id prefix), leaving out hidden helper images, and with WordPress's own faults in mind: an alt cut short at a double quote, and a theme that prints the attachment title when alt is empty.
9. **Performance**: Lighthouse mobile on the home page, a media-heavy item, an article and the heaviest listing. Fix layout shift from fonts.
10. **Code parity**: see below.
11. **Editor acceptance**: through the Designer or Editor, change a hero, replace a gallery image, reorder a curated list, publish a new article, with no code change. The agent does it and records how; the owner repeats it at review. Then run the new-item test below.
12. **Reuse check**: `LEARNINGS.md` current, `site.config.json` holds every site value, scripts grep clean of site literals.

## Code parity: the check that finds what the others miss

Before calling a migration done, diff the old live site against the new one at the level of code, one page per template (`scripts/code-parity.py`): scripts by purpose, link tags, meta tags, JSON-LD types, noscript blocks, iframes. Then compare the tag manager container's triggers with the DOM hooks in the new markup, then HTTP behaviour.

On the reference migration this found what page-by-page visual and SEO checks had missed: no Open Graph or Twitter tags on any CMS template, a breadcrumb list the SEO plugin printed on every page, the form provider's tracking loader (which also carried the cookie banner), and root icon files.

Also check what fires before consent. Tag manager containers often load lead-tracking scripts with no consent setting; the rebuild inherits that unless someone decides otherwise. Report it; it is the owner's call.

## A check that did not run looks like a pass

On the third build two checks reported nothing wrong because they compared nothing. The share picture on item pages had never been compared (the SEO check looked at titles and descriptions; code parity confirmed the tag existed on static pages), and the structure check had been written for an earlier build's markers. Both were found late, one of them by a second session.

- **Every check prints what it compared**: how many pages, how many values. Zero compared is a failure, not a pass.
- **Say what share of the site a check covered.** "27 specs passed" reads like the site passed; it meant 27 pages and examples out of nearly 200. Any check that samples is followed by one that does not (for layout, the whole-page sweep).
- **Name the evidence for each "Done when" line by what was compared with what**, not by which script was run.
- **Have a session that did not do the build check the result** before hand-off, against pages saved from the live site at the start: every sitemap address answers on staging, and title, description, `h1` and share picture match per page. It needs only `curl` and the saved pages, and it is not anchored on the build's own reports.

## Test a new item the way an editor makes it

Imported items carry fields an editor will never fill: the WordPress id, a publish timestamp, a generated card excerpt. Create one new item by hand with only what an editor would enter (make it awkward: long title, no excerpt, no optional media), publish it, and look everywhere it should appear. On the reference migration this exposed:

- lists keyed or filtered by the WordPress id dropped the new item (slider picks, page de-duplication);
- stored "related" lists never included it;
- card text bound to an importer field was blank;
- a template title bound to an optional SEO field published an empty `<title>`;
- date ordering that relied on an importer timestamp put it in the wrong place;
- a card link bound to an importer-only address field was empty (let the script fall back to the collection's folder plus the slug);
- the share picture was empty, because the field behind it was optional.

The fixes generalise: key by link, not by importer id; compute related lists at view time from lists the template already holds; give card text a fallback (excerpt, else the first words of the body); make the fields a template cannot do without **required**; sort by day with Webflow's own order as the tie-break. Then confirm the new item is on top wherever "newest" is promised, that grids still hold their shape with one more item, and that curated lists are unaffected. Delete the test item and confirm it is gone from listings, related lists, the sitemap (after a full publish) and search.

Tell editors what is automatic and what is not: automatic lists pick new items up on publish; curated lists never do; the sitemap needs a full site publish; search needs a reindex.

## Noise to recognise

- A one-line text wrap flipping at an exact breakpoint.
- The old site's fixed header covering click targets in tests.
- Differences confined to a slider or a lazy image, with equal page heights, were always a slider mid-transition or media not yet loaded, on either side. Turn reduced motion on, force lazy images eager, and measure again before fixing anything.
- Headings inside slider tracks differ between slider libraries (one hides off-screen slides from assistive technology, another does not). Leave slider tracks out of the heading crawl and cover sliders with the block measurement and the behaviour suite.
- **`aria-hidden` sits on different elements on each side** (inactive slides, tab panels, hero slides). A text comparison that drops everything `aria-hidden` counts one slide on one side and every slide on the other, and one that keeps everything counts decoration. Drop only `aria-hidden` elements that hold no letters or digits, on both sides.
- Two slider libraries park their off-screen slides on opposite sides of the track (one wraps them to the left with negative x, the other keeps them to the right, clipped). Boxes differ, the visible slide does not: measure the visible slide.
- A listing that counts its active filters from every query parameter counts a cache-buster too ("All filters (1)"). The theme does the same; see "Cache-bust the Webflow side only".
- Links that sit side by side in the new markup with no whitespace between them (navigation, footer) read as one word in the raw HTML though they render apart. `scripts/glued-words.mjs --rendered` compares rendered text and does not trip on them (the raw mode flagged 171 pages for this alone). A map widget's own buttons can still read as one word there; leave them out with `checks.glued.skipWithin`.
- Staging and live HTML differ in compiled CSS names and Webflow attributes; strip the Webflow runtime tags and `data-wf-*` before comparing bodies.
- Map errors on staging when the key is restricted to the live domain: environment, not a regression.

## Browser testing gotchas

- **Click with the real pointer**, after scrolling the target into view. Script clicks hid a z-index bug.
- A slider sized before its parent changes width keeps old slide widths until a resize event. Set widths before init or dispatch resize.
- WebKit tabs only to form fields by default; use Option+Tab for link focus tests.
- `offsetParent` is null for fixed elements; use the bounding rect.
- Mobile WebKit has no mouse wheel; scroll by script.
- Check phone landscape (844×390, less about 230px of browser bars in Safari): menus that give a link list "the leftover height" collapse to nothing, sometimes on the old site too.
- Autoplay that stops on the last slide strands phones when the previous control is hidden. Copy the old slider's wrap behaviour.
- iOS Simulator screenshots lag taps by about a step; wait two or three seconds.
- Test a bundle before releasing it: `scripts/bundle-swap.mjs` serves the unreleased build in place of the release on real staging pages.
- Re-run the whole behaviour suite after every release, not only the checks you think you touched.

## Accepted differences

Keep `verify/accepted-differences.md`: each difference with its reason. Any that loses content or behaviour needs the owner's yes.
