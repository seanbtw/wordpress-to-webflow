# Verification

The aim: no difference a user would notice, no URL lost, no behaviour missing, and proof of each. Verify the pages that produce the traffic first and strictest (Search Console tells you which).

## Contents
- Measuring
- The Phase 7 checks
- Code parity: the check that finds what the others miss
- Test a new item the way an editor makes it
- Noise to recognise
- Browser testing gotchas
- Accepted differences

## Measuring

- **Measure against the local WordPress at the same width, both sides of every breakpoint**: 390, 479/480, 767/768, 991/992, each of the theme's further steps and the pixel below it (for example 1199/1200), 1440 and 1920. This caught wrong breakpoints, missing steps, a line-height coming from an inline span, a slider overriding widths, clamp and paragraph sizes, tag padding and button geometry.
- **Use the theme's own numbers** (compiled CSS, block options) as the expected values, and the browser's computed values on both sites as the measurement.
- **Force lazy images eager and decoded** before measuring or capturing.
- **Keep block order equal to the reference page's** when measuring a block in isolation; some theme behaviour depends on neighbours.

## The Phase 7 checks

1. **Structure**: component sequence per page equals the composition map, by script.
2. **Visual**: one comparison sheet per page and template example: reference left, Webflow right, pixel-diff strip between, at 390, 768, 1200, 1440 and 1920, captured with the reference settings, plus the defined scroll-state captures. Review every sheet. **Triage by page height difference first** (lost or added content), then by percentage of differing pixels.
3. **Behaviour and accessibility**: the behaviour checklist, every line ticked with width and browser, including real Safari and iOS Safari. Menus, search, forms, sliders, accordions, filters, sticky elements, modals, maps, keyboard focus, reduced motion.
4. **Console**: no errors on any page at any width (`scripts/console-check.mjs`).
5. **Links and media**: crawl staging (`scripts/crawl-links.mjs`): zero broken internal links; zero references to the old host or to localhost in HTML, `srcset`, CSS backgrounds, embeds or JSON-LD; then crawl again with requests to the old host blocked and confirm nothing visible breaks.
6. **URLs**: `scripts/check-urls.mjs` at zero failures.
7. **Content**: automated body comparison at 100% (`scripts/compare-bodies.mjs`), `scripts/glued-words.mjs` over every page, plus side-by-side spot checks of a sample of each type.
8. **SEO** (`scripts/seo-check.mjs`): exactly one `h1`; title and description equal the inventory; JSON-LD parses and validates; Open Graph tags present on templates; sitemap lists what it should and nothing else.
9. **Performance**: Lighthouse mobile on the home page, a media-heavy item, an article and the heaviest listing. Fix layout shift from fonts.
10. **Code parity**: see below.
11. **Editor acceptance**: through the Designer or Editor, change a hero, replace a gallery image, reorder a curated list, publish a new article, with no code change. The agent does it and records how; the owner repeats it at review. Then run the new-item test below.
12. **Reuse check**: `LEARNINGS.md` current, `site.config.json` holds every site value, scripts grep clean of site literals.

## Code parity: the check that finds what the others miss

Before calling a migration done, diff the old live site against the new one at the level of code, one page per template (`scripts/code-parity.py`): scripts by purpose, link tags, meta tags, JSON-LD types, noscript blocks, iframes. Then compare the tag manager container's triggers with the DOM hooks in the new markup, then HTTP behaviour.

On the reference migration this found what page-by-page visual and SEO checks had missed: no Open Graph or Twitter tags on any CMS template, a breadcrumb list the SEO plugin printed on every page, the form provider's tracking loader (which also carried the cookie banner), and root icon files.

Also check what fires before consent. Tag manager containers often load lead-tracking scripts with no consent setting; the rebuild inherits that unless someone decides otherwise. Report it; it is the owner's call.

## Test a new item the way an editor makes it

Imported items carry fields an editor will never fill: the WordPress id, a publish timestamp, a generated card excerpt. Create one new item by hand with only what an editor would enter (make it awkward: long title, no excerpt, no optional media), publish it, and look everywhere it should appear. On the reference migration this exposed:

- lists keyed or filtered by the WordPress id dropped the new item (slider picks, page de-duplication);
- stored "related" lists never included it;
- card text bound to an importer field was blank;
- a template title bound to an optional SEO field published an empty `<title>`;
- date ordering that relied on an importer timestamp put it in the wrong place.

The fixes generalise: key by link, not by importer id; compute related lists at view time from lists the template already holds; give card text a fallback (excerpt, else the first words of the body); make the fields a template cannot do without **required**; sort by day with Webflow's own order as the tie-break. Then confirm the new item is on top wherever "newest" is promised, that grids still hold their shape with one more item, and that curated lists are unaffected. Delete the test item and confirm it is gone from listings, related lists, the sitemap (after a full publish) and search.

Tell editors what is automatic and what is not: automatic lists pick new items up on publish; curated lists never do; the sitemap needs a full site publish; search needs a reindex.

## Noise to recognise

- A one-line text wrap flipping at an exact breakpoint.
- The old site's fixed header covering click targets in tests.
- Large pixel differences with equal page heights were always sliders mid-transition or lazy images and iframes not loaded in the capture, on either side. Confirm in a browser before fixing anything.
- Video embeds render as black blocks in static captures.
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
