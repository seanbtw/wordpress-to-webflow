# The WordPress side: local reference and inventories

## Run the backup locally

1. **Check the archive.** Compare the extracted folder with the zip's own manifest (every file at its path with its size), then test integrity. Use Python's `zipfile` with Unicode normalisation; `unzip -l` mangles names containing en dashes.
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
- `seo.csv`: the **rendered** SEO output per URL (title, description, canonical, robots, Open Graph image, JSON-LD), fetched from the local pages. Rendered values, not the plugin's raw patterns.
- `assets.csv`: every referenced upload with path, size, hash, dimensions, alt text and the records that use it.
- `urls.csv`: every public URL with its expected destination on the new site.
- `redirects.csv`: the redirect rows the build produces (host rules converted, deliberate path changes, slugs Webflow altered). The importer appends a row here whenever a slug changes.
- `counts.md`: acceptance counts per type and status. Generated, never typed.

## Reference screenshots

Capture every static page and one example per template chosen to cover optional data (the longest article, an item with video, one with a form), at 390, 768, 1200, 1440 and 1920 wide. Fix the conditions and write them down: viewport height, device scale 1, fonts loaded, lazy images forced eager and decoded, sliders and video paused on the first frame, scroll position 0, plus one capture of each fixed or sticky layout at a defined scroll position.

## Things WordPress does that the exports don't show

- **Redirects held inside WordPress** (plugins, canonical redirects, old-slug redirects) are not in the host's export. Capture live behaviour with `scripts/live-capture.mjs`; don't trust the export alone.
- **`wp_is_mobile`**: some themes pick blocks by user agent. Compare phones with a real phone profile, not a narrow desktop window.
- **wptexturize**: WordPress renders `...` as `…` and straight quotes as curly. Compare and copy against rendered text, not the raw field.
- **Term order**: templates often print taxonomy terms by name, not by stored order. Check which the theme uses before storing references in display order.
- **Ties in date order**: WordPress's own order for items with equal dates varies between queries, so the reference is not stable there. Don't chase it, and don't break ties on an importer-only field (new items won't have one): sort on the date field editors fill and let Webflow's own order settle ties.
- **Alt text fallbacks**: some themes print the attachment title when alt is empty. Decide per site whether to copy that.
- **Theme rules that hang off a wrapper** are lost when blocks are rebuilt outside it: list bullets under an `article` wrapper, text colour set by each container, a global `p` size beating a larger parent. Grep the theme CSS for descendant rules on its wrappers before building blocks.
- **Core block CSS** has its own breakpoints (core columns wrap below 782px with `!important`).
- **Inline colours**: editors colour text with inline `style` on dark sections. Dropping it leaves dark text on dark; map each colour to a class.
- **Scripts that re-run on load**: a filter link with an init hook can reset state on every load. Measure filtered states against the server render with JavaScript off, and don't copy the reset.
- **Timing quirks are part of the reference**: if one block equalises heights only after another fires a resize, equal heights depend on block order. Copy the rule, not the look on one page.
- **Placeholder content**: check the content, not just the layout. FAQ answers may be empty or Lorem ipsum; structured-data emitters must skip them.
- **The tag manager container is public and decodable**: list every trigger's DOM hook and check it exists in the new markup. Expect some to be dead already on the old site.
- **The cookie banner may belong to the form or CRM provider**, loaded by its tracking script and configured per domain in that provider's settings, not in WordPress. To see it on staging, the staging domain has to be added there first.
- **Card excerpts generated from the local pages carry the local origin.** Rewrite local links after any regeneration.
