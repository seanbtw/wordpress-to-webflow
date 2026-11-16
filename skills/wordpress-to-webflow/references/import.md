# CMS schema and import

## Field mapping (ACF and core → Webflow)

| WordPress / ACF | Webflow |
|---|---|
| text, textarea | PlainText |
| wysiwyg, post body | RichText |
| image | Image |
| gallery | MultiImage (max 25; validation fails above it) |
| file | File (10 MB limit) or a Link to a file you host |
| link | Link plus a PlainText label |
| url, oembed | Link / VideoLink |
| number, range | Number |
| true_false | Switch |
| select, radio, button group | Option |
| post object or relationship (single) | Reference |
| post object (multiple), taxonomy terms | MultiReference, plus an ordered id list where order across collections matters |
| repeater | no equivalent: a fixed set of fields when there are never more than three rows, else RichText or a child collection |
| group | flatten with a prefix |
| map | address, latitude, longitude |
| date/time | DateTime |
| code field | PlainText rendered in an Embed |
| colour picker | Color, **plus a PlainText copy**: a Color field cannot be bound by API, as text or as a style, so scripts and attributes read the copy |

Taxonomies become small collections. Collection slugs equal the WordPress post-type slugs so item URLs match. Where a post type and a taxonomy are merged into one collection (a client is both a post and a term), keep the **post** slug as the item slug, because that is the page WordPress serves; store the term slug in its own field for filters.

**Add a Switch for every "if this field is set" in a template.** Element visibility binds only to Switch fields by API ("is set" conditions on an image or text field are Designer-only). For each conditional in the theme's template (a second image, an author, an avatar, a second tag) add a Switch and let the importer fill it. For a field with no Switch, Webflow marks an empty binding with `.w-dyn-bind-empty`, so `:has(.w-dyn-bind-empty)` can hide its wrapper with no script.

Add importer fields to every collection: the WordPress id (identity) and the original publish date. Importer fields are for the import and the re-sync only. Nothing a visitor sees may depend on them, because an item an editor creates later will not have them (see `verification.md`, "Test a new item the way an editor makes it").

A bound DateTime prints as a formatted day ("March 3, 2025") in attributes and text. A script that orders items client-side should parse that day and keep Webflow's order within a day, not rely on an importer-only timestamp. Where the order within a day matters (several posts on one date), give every dated type a Number timestamp field the importer fills and sort on that first, then the day, and place an item with neither as the newest.

**The item's address is the one WordPress serves, not `post_name`.** A permalink plugin can give any post, of any type, its own address (the Custom Permalinks plugin keeps it in `custom_permalink` post meta). Take the slug, any stored link field and the SEO lookup from the served permalink in `urls.csv`. An importer that did this for one post type and used `post_name` for the others moved an article with about 2,000 search impressions to a new address.

**A hand-picked order can live in a Number field.** Where Webflow refuses a curated list (see `webflow-traps.md`, "Collection Lists"), the importer writes each item's position in the WordPress pick list to an Order field and a script sorts by it.

## Import mechanics

- **Read from the inventory, not the live site.** Write with the Data API in batches of up to 100 items, respect the rate limit, checkpoint after every batch, and make it resumable.
- **Identity is source type plus WordPress id**, stored on every item and in an id map. Slugs are URL data: a slug change on re-import updates the same item and writes a redirect row.
- **Two passes.** Pass 1 creates every item with scalar and media fields. Pass 2, once every id is known, sets all references (including self-references and cross-references), validates required references, then publishes only items whose source status is published. Drafts, private, scheduled and pending items are imported as drafts; trashed items are skipped and listed.
- **On a re-sync**, an item whose source has since been unpublished or trashed is unpublished and listed for the owner; delete only on their yes. A changed slug updates the same item and appends a row to `inventory/redirects.csv`, which the redirect build reads.
- **Bulk creates can duplicate.** A timed-out POST may still create every attempt, even minutes later. Never resend a create blindly: re-list and match on the WordPress id field.
- **Idempotence is the test.** A second run must report 0 creates and 0 updates. This is what the cutover re-sync reuses.
- **Prove refactors with a fingerprint**: a hash over every item the importer would produce, before and after a change to the importer.
- **Read CSV files with `\r?\n`.** A file saved with Windows line ends puts a carriage return on the end of every last-column value; link targets read that way made the body comparison block 22 items.

## Media

- **Upload from the local backup, not by URL.** The old host may refuse Webflow's URL fetch (WP Engine answered 403). Create the asset, then POST the bytes to the upload URL it returns. This works through the MCP with no assets scope on the site token.
- **Webflow's own remote-file fetch fails now and then** with a blank reason for a file that serves 200. Treat it like an unsure create: wait, re-list, create only what is missing.
- **Images inside embed and plain-text fields are not copied.** Webflow rehosts images in image and rich-text fields only; an embed (a flipbook, a code block) keeps its `<img>` pointing at the old site. The importer must stage those URLs itself.
- **One shape for the media manifest.** The importer, the media check and the body converter all read and write it. When two of them wrote different shapes, the import stopped being idempotent after a media check. Document the shape, and prove idempotence with a media check *between* two import runs.
- **Size limits**: images over 4 MB are rejected; re-encode to a 2560px WebP. Files over 10 MB (PDF, video) go to storage you control, served under a stable path with Range support.
- **Webflow dedupes uploads by content**: uploading bytes that match an existing asset returns the existing asset under its old file name. A checker comparing file names needs an alias keyed by hash.
- **Keep a media manifest**: every asset with its destination. After import, fetch every destination and confirm 200 and the right dimensions.
- Webflow serves responsive variants of uploaded images with `-p-<width>` added to the file name.
- Webflow CMS images get no `srcset`, and every image is marked `loading="lazy"`. Make the hero or first image eager with a small early inline script.

## Body conversion

- Convert from the parsed block tree plus the rendered HTML; keep block order, captions, media layout, video options, button labels and targets; expand reusable blocks.
- Decide the mapping for every theme block that appears inside bodies. What rich text cannot hold (theme buttons, tables, rules, specially styled paragraphs) becomes a small embed.
- **Sample complex bodies before trusting the converter.** Sampling 20 found: lead spans with their own weight, a paragraph class that looked like a heading, a missing gap after embedded paragraphs, trailing empty blocks.
- Flattening wrappers loses styles carried by inner spans (a testimonial's lead style). Reapply them in CSS.
- **A lead style inside a heading stays a heading.** Mapping every whole-element lead span to a blockquote is right for paragraphs and wrong for headings: on one site 96 leads sat inside `<h2>` or `<h3>`, and a blockquote was the wrong weight and 4 to 8 px off per line. Keep `<hN><span class="lead">` as a small embed; only a lead inside a paragraph becomes a blockquote.
- **Short rich-text fields keep their headings.** A cleaner for answers, quotes and bios that keeps only paragraphs, emphasis, links and lists turns an editor's `<h2>` quote into a `<p>` and loses its face and colour. Keep h2 to h4, and record any inline colour the CMS cannot store so the page code can restore it.
- **Empty paragraphs**: WordPress renders them with a margin. Either keep the gap or add it to the next block; measure to find them. A test for "empty" written with `trim()` also drops `<p>&nbsp;</p>`, because `trim()` strips the no-break space: keep any paragraph that holds one. In a flex or grid parent an empty `<p>` is an item with margins; keep it as a zero-height div with those margins.
- **Rewrite body links to their final address at import.** A link to an old address works on WordPress through its own redirect and breaks on staging until the redirects are imported. Resolve each internal link through the redirect file (exact internal rules only) so no editor link depends on a 301. Do the same for static menu and footer links.
- **Rich text cannot carry inline styles.** An editor's `style="color:…"` or `style="font-weight:…"` on a span is lost. Keep colour inside the embeds the converter already makes, and record what remains as an accepted difference.
- **Write quotes and apostrophes as WordPress shows them** (curly, in names and titles), and normalise them only inside comparisons.
- **Automated comparison for every body**: text, media count, link set. A failure blocks that item's publish.
- **Spaces at the end of a span can vanish** when a page is built ("system.</span><span>Overall"). Comparisons that collapse whitespace miss it; run `scripts/glued-words.mjs --rendered` over every page. The cause and the repair are in `webflow-traps.md`, "Building elements".
- **Card excerpts**: themes often generate them (first N words of the body, sometimes with links). Give cards a rich-text excerpt field, and a fallback for items without one.

- **Order the converter's passes so the ones that recognise theme markers run first.** A general clean-up of inline styles ran before the pass that finds the theme's lead-paragraph span and unwrapped it; 19 article leads became plain body text. Never unwrap a span that carries a theme class. Count each marker in the WordPress HTML and in the converted bodies.
- **Every field WordPress prints through its content filter gets the same typographic treatment on import.** Titles had curly quotes and dashes and bios did not, on eight items; an en dash is wider than a hyphen, so lines broke differently. Take the expected text from the rendered page, never the raw database value.
- **Check each item's address against WordPress before publishing a collection.** Items that are a name only, with no page of their own, answered "Page not found" on WordPress and an empty page on staging. Unpublishing them removes them wherever they are listed, so decide with the owner; one way through is a slug for those items that no old address uses.

## SEO fields

Take titles, descriptions, canonical and Open Graph images from the rendered `seo.csv`. Keep them exactly: they rank today. Bind template titles to a **required** field, or a new item without it publishes an empty `<title>`.

**Give every template an SEO title field filled from `seo.csv`**, not a title assembled as "name, then site name". The SEO plugin's own title differs from the assembled one wherever WordPress texturizes the name (a curly apostrophe).

**Give every template an Open Graph image field** holding the picture WordPress prints for that item, and print it from template head code (`webflow-traps.md`, "Pages, templates and head code"). The SEO plugin may print a generated size (`-1024x683`) or a URL with `?ver=`; Webflow renames a duplicate upload (a `-1` dropped, `.jpg` become `.jpeg`). So the check compares by file name first and by content second (`scripts/seo-check.mjs`).

Any plain-text field that a JSON-LD block in template head code reads must be written as **one line**: a raw line break in the field breaks that item's JSON (see `structured-data.md`).
