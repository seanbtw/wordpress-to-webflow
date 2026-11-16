# The WordPress side: local reference and inventories

## Run the backup locally

1. **Check the archive** (`scripts/archive-check.py`). Compare the extracted folder with the zip's own manifest (every file at its path with its size), then test integrity. Use Python's `zipfile` with Unicode normalisation; `unzip -l` mangles names containing en dashes. **Look for names that differ only in letter case.** One uploads folder held 68 such pairs, every pair two different files; a case-insensitive disk (the macOS default) keeps one of each and reports nothing. Extract both copies of each pair to a side folder, check with an exact-case lookup, and point the media build and the media check at the side folder for those paths.
2. **Work on a copy.** Never mount the original extraction; copy it to an expendable folder.
3. **Docker**: the WordPress image pinned to the version in the backup's `wp-includes/version.php`, a matching database image, and a WP-CLI container. Bind to `127.0.0.1` only.
4. **Do not use the archive's `wp-config.php`**: it holds live credentials and host-specific constants. Let the image generate one, set the same table prefix the dump uses, and add `DISABLE_WP_CRON` and a local environment type.
5. **Remove host-only code before first boot**: must-use plugins from the host and any `object-cache.php` or `advanced-cache.php` drop-in.
6. **Import the database, then search-replace** the live origin with the local one across all tables, skipping `guid`.
7. **Deactivate plugins that phone home or get in the way** (caching, security, auto-updaters, mail). Before deactivating anything else, grep the theme for what it depends on. Keep a plugin active if the theme renders through it (form shortcodes, custom fields, SEO, search), and block its outbound tracking instead.
8. **Create a local admin user**; keep its password in a gitignored file.
9. Check whether the theme reads an `.env` file or other file outside the web root on boot, and mount an empty one if so.

## Inventories

Generate all of these with one script, so cutover can rerun it and diff:

- `posts.csv`: every post of every type with id, type, status, slug, title, dates, content hash.
- `pages/<slug>.json`: the parsed block tree per page, reusable blocks expanded.
- `bodies/<type>/<id>.json`: parsed blocks **and** rendered HTML for every long-form body.
- `options.json`, `navigation.json`: theme options, menus, footer, social links, snippets.
- `seo.csv`: the **rendered** SEO output per URL (title, description, canonical, robots, Open Graph image, JSON-LD), fetched from the local pages. Rendered values, not the plugin's raw patterns. Keep the breadcrumb names the SEO plugin prints per URL (HTML-decoded): the new site's breadcrumbs reuse them, so no wording is invented.
- `device-blocks.csv`: every container or block the theme shows or hides by device, with the page it is on.
- `assets.csv`: every referenced upload with path, size, hash, dimensions, alt text and the records that use it (`seo-check.mjs` reads the columns named `file` and `alt`).
- `urls.csv`: every public URL with its expected destination on the new site.
- `redirects.csv`: the redirect rows the build produces (host rules converted, deliberate path changes, slugs Webflow altered). It is an output, rewritten by every run of `build-redirects.py`; a slug the importer changes goes into `redirects.extra` in the config.
- `counts.md`: acceptance counts per type and status. Generated, never typed.

## Reference measurements

Measure every static page and one example per template chosen to cover optional data (the longest article, an item with video, one with a form), at 390, 768, 1200, 1440 and 1920 wide. Record as JSON, per page and width: the ordered sections of `main`, each block's box and background, the computed type (family, size, weight, line height, letter spacing, colour) of its first text elements, header and footer boxes, the `h1` list and the page height. Fix the conditions and write them down: viewport height, device scale 1, fonts loaded, lazy images forced eager and decoded, reduced motion on so sliders rest on their first slide, scroll position 0, a phone user agent below the tablet width. Write the script so the same code measures staging from another origin.

Differences are found by comparing these values and the code, never by comparing pictures. A screenshot may be saved beside each measurement as a record for the person reviewing; it is not evidence and nothing is decided from it.

## Reading the live site

- **The local copy is the reference.** The live site is read only for what the backup cannot hold: redirects, what changed since the backup, and one saved copy of each page's HTML taken at the start, which the code-parity diff and the outside check compare against later.
- **A managed host's firewall often refuses plain scripted requests** from the build machine, sometimes after only a handful. The scripts that read the live site (`live-capture.mjs`, `code-parity.py`) go one request a second for that reason and may still be refused: run them early, and if they are blocked, fetch through a real browser or from the server itself.
- **With SSH access and WP-CLI, "what changed since the backup" takes minutes**, with no new multi-gigabyte download: run the same read-only queries (post ids, modified dates, content hashes, option values) on the live server and on the local copy and compare the text. Ask the owner before connecting, and run nothing that writes.

## Things WordPress does that the exports don't show

- **Redirects held inside WordPress** (plugins, canonical redirects, old-slug redirects) are not in the host's export. Capture live behaviour with `scripts/live-capture.mjs`; don't trust the export alone.
- **Menu links can point at old addresses** and still work, because WordPress redirects an old slug by itself. On the new site they break until the redirects are imported. Rewrite static menu and footer links to the final page.
- **A permalink plugin can set the address of any post type** (see `import.md`). The address in the post's own row is then not the one served.
- **Blocks chosen by device, not width.** Some themes pick markup by user agent (`wp_is_mobile`, or a detection library behind a per-container "hide on mobile / tablet / desktop" option), on the server. A desktop fetch never sees the phone version: one home page served a different news section to phones and tablets. List every container that carries such an option in the inventory, fetch and measure with a phone user agent as well, and compare phones with a real phone profile, not a narrow desktop window.
- **wptexturize**: WordPress renders `...` as `…` and straight quotes as curly. Compare and copy against rendered text, not the raw field.
- **Term order**: templates often print taxonomy terms by name, not by stored order. Check which the theme uses before storing references in display order.
- **Ties in date order**: WordPress's own order for items with equal dates varies between queries, so the reference is not stable there. Don't chase it, and don't sort a list on an importer-only field (new items won't have one, and fall to the end): sort on the date field editors fill and let Webflow's own order settle ties. A script may use an importer timestamp as the tie-break within a day (`import.md`).
- **Alt text fallbacks**: some themes print the attachment title when alt is empty. Decide per site whether to copy that.
- **Theme rules that hang off a wrapper** are lost when blocks are rebuilt outside it: list bullets under an `article` wrapper, text colour set by each container, a global `p` size beating a larger parent. Grep the theme CSS for descendant rules on its wrappers before building blocks. The same goes for size: a theme that sets a slider's container to 84% of the row, except inside its page container where it is 100%, gives a block compiled on its own the 84% (cards 80 to 200 px too narrow on every hand-picked slider). Compile each block at the width it has on its real page, or check the theme CSS for a rule scoped to the page container for each compiled root.
- **Layout lives in three places the theme's utility classes don't show**: WordPress core block CSS (core columns are flex, wrap below 782px with `!important`, with their own gap; per-page `.wp-container-*` rules are printed inline), block-scoped theme rules that hang off a block's own class, and padding a script adds to `main` for a fixed header. Keep 782 as an exact media query in the stylesheet; Webflow has no breakpoint there.
- **Empty paragraphs hold space.** WordPress keeps `<p></p>` with its margin; a converter that drops them loses the gap.
- **Stored alt text is printed unescaped by some themes**, so an alt containing a double quote is cut short in the live HTML. Compare against the stored value and decide which to carry.
- **A stray query parameter can change the page.** A listing that reads every query parameter as a filter shows its "clear filters" state when a measuring tool adds a cache-buster. Never add one on the WordPress side.
- **The host's redirect rules do not run on the local copy.** A path that 404s locally may be redirected on live by the host, sometimes through a second host rule. Anything that asks "does this old URL work?" must apply the host's rules first (see `redirects.md`).
- **Inline colours**: editors colour text with inline `style` on dark sections. Dropping it leaves dark text on dark; map each colour to a class.
- **Scripts that re-run on load**: a filter link with an init hook can reset state on every load. Measure filtered states against the server render with JavaScript off, and don't copy the reset.
- **Timing quirks are part of the reference**: if one block equalises heights only after another fires a resize, equal heights depend on block order. Copy the rule, not the look on one page.
- **Placeholder content**: check the content, not just the layout. FAQ answers may be empty or Lorem ipsum; structured-data emitters must skip them.
- **Editors put headings where a field looks like a paragraph**: testimonial quotes and short answers stored as `<h2>` with an inline colour. See `import.md`, "Body conversion".
- **The tag manager container is public and decodable**: list every trigger's DOM hook and check it exists in the new markup. Expect some to be dead already on the old site.
- **The cookie banner may belong to the form or CRM provider**, loaded by its tracking script and configured per domain in that provider's settings, not in WordPress. To see it on staging, the staging domain has to be added there first.
- **Card excerpts generated from the local pages carry the local origin.** Rewrite local links after any regeneration.
