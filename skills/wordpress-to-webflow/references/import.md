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

Taxonomies become small collections. Collection slugs equal the WordPress post-type slugs so item URLs match.

Add importer fields to every collection: the WordPress id (identity) and the original publish date. Importer fields are for the import and the re-sync only. Nothing a visitor sees may depend on them, because an item an editor creates later will not have them (see `verification.md`, "Test a new item the way an editor makes it").

A bound DateTime prints as a formatted day ("March 3, 2025") in attributes and text. A script that orders items client-side should parse that day and keep Webflow's order within a day, not rely on an importer-only timestamp.

## Import mechanics

- **Read from the inventory, not the live site.** Write with the Data API in batches of up to 100 items, respect the rate limit, checkpoint after every batch, and make it resumable.
- **Identity is source type plus WordPress id**, stored on every item and in an id map. Slugs are URL data: a slug change on re-import updates the same item and writes a redirect row.
- **Two passes.** Pass 1 creates every item with scalar and media fields. Pass 2, once every id is known, sets all references (including self-references and cross-references), validates required references, then publishes only items whose source status is published. Drafts, private, scheduled and pending items are imported as drafts; trashed items are skipped and listed.
- **On a re-sync**, an item whose source has since been unpublished or trashed is unpublished and listed for the owner; delete only on their yes. A changed slug updates the same item and appends a row to `inventory/redirects.csv`, which the redirect build reads.
- **Bulk creates can duplicate.** A timed-out POST may still create every attempt, even minutes later. Never resend a create blindly: re-list and match on the WordPress id field.
- **Idempotence is the test.** A second run must report 0 creates and 0 updates. This is what the cutover re-sync reuses.
- **Prove refactors with a fingerprint**: a hash over every item the importer would produce, before and after a change to the importer.

## Media

- **Upload from the local backup, not by URL.** The old host may refuse Webflow's URL fetch (WP Engine answered 403). Create the asset, then POST the bytes to the upload URL it returns.
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
- **Automated comparison for every body**: text, media count, link set. A failure blocks that item's publish.
- **Spaces at the end of a span can vanish** when a page is built ("system.</span><span>Overall"). Comparisons that collapse whitespace miss it; run `scripts/glued-words.mjs` over every page.
- **Card excerpts**: themes often generate them (first N words of the body, sometimes with links). Give cards a rich-text excerpt field, and a fallback for items without one.

## SEO fields

Take titles, descriptions, canonical and Open Graph images from the rendered `seo.csv`. Keep them exactly: they rank today. Bind template titles to a **required** field, or a new item without it publishes an empty `<title>`.
