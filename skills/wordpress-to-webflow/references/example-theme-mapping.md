# A worked example: one block theme mapped to Webflow

This is the mapping file from the reference migration, with the theme's name removed. Use it as a model for your own `theme-mapping.md`, and as a starting point if your theme has the same shape: a custom block theme built on Tailwind with custom screens, a small script library for behaviour, Flickity for every slider, custom-field blocks and an SEO plugin.

A theme's source is the specification, and it is someone's code: read it locally, never copy it into a repository or into this skill.

## Theme facts that shaped the build

Find the equivalent of each of these in your theme before Phase 1.

- **Screens were custom, not the framework's defaults**, with steps at 1200 and 1500 that Webflow has no breakpoint for. Webflow's 992, 768 and 480 lined up with three of the theme's screens; the others went in the CSS file or used the clamp switch.
- **Every slider was Flickity** (with its fade add-on). The options in each block's script were the spec. A replacement library must copy what Flickity does: autoplay that wraps even without wrap-around, and autoplay stopping on drag. Whether autoplay pauses on hover is a choice for the owner (Flickity's default is to pause): apply the old site's behaviour and put it on the waiting list.
- **Some blocks were chosen by user agent** (`wp_is_mobile`), and containers had a "hide on mobile / tablet / desktop" option decided on the server by a device-detection library. On a second site, the home page served a different section to phones and tablets.
- **Core block columns** wrapped below 782px, a width neither the theme's screens nor Webflow has.
- **Every `ul` under the article wrapper got bullets and spacing**, every container set its own text colour (dark and light variants), and a global paragraph size beat a larger parent. These went into the CSS file before any block was built.
- **The picture helper printed the attachment title as alt** when alt was empty.
- **Card excerpts** were the first 15 words of the body and could contain links.
- **Menus collapsed on short screens**: the link list took the leftover height.
- **Buttons ignored `target`**: they never opened a new tab.
- **Height equalising in one slider ran only after a resize event** that other blocks fired, so it depended on block order.

## Block mapping

The theme had 24 blocks; the table shows the ones whose mapping carried a lesson, with near-identical blocks grouped in one row.

| Theme block | In Webflow | Notes |
|---|---|---|
| Spacer | Component, variants for the padding tiers and optional rule | |
| Buttons | Component with a row slot holding Button instances | Button is a div with a full-size link overlay and hidden label (no slots inside Link Blocks); icon slots |
| Icons | Small components, theme SVGs inline with `currentColor` | |
| Media | Component | |
| In-page navigation | Component, a variant per menu, link lists inside the component (have the script show the list that holds the current page; a variant class was published on one instance only: `webflow-traps.md`) | Real `<button>` toggle |
| Accordion | Component plus an item component, dark and light | Behaviour in the bundle |
| Full-width call to action | Component with variants and a Buttons slot | |
| Static hero | Component | |
| Hero slider | Component with a slot of slide components | Fade. For one `h1` per page, make only the first slide's heading the `h1` |
| Testimonial slider | Page-owned shell plus a curated list | Curated items cannot vary per component instance |
| Post slider | Page-owned shell plus Collection List(s) of a card component; optional call-to-action end slide | Card props bound to CMS fields; tag list in a slot; slide widths per breakpoint from CSS; options as combo classes |
| Card slider | The post slider shell with static card slides | No new script |
| Image carousel | Not built (no placements) | Its theme script equalled the hero slider's, so that module is the starting point |
| Rich text bodies | CMS RichText with conversion rules | Lead text in a paragraph → blockquote; lead text inside a heading stays a heading, as a small embed; special paragraph classes, theme buttons, tables and rules as small embeds |

## What a second site on the same theme changed

- The block list and the vendor code were identical; 81 theme files differed. The button package was byte-identical, so the button component carried over, but the compiled button rules were not: a new top margin on label and icon spans, another line height, one more colour variant. None of that showed in a differing template.
- The type scale was the site's own: one class added, two missing, a different heading weight, letter-spacing on one class only.
- No mega menu and a callback panel in the navigation; the footer had no props because there was one footer.
- The static hero gained a variant for pages with an in-page navigation above it, and its image layer was fixed so the next block scrolled over it.
- Blocks were compiled from the rendered theme rather than hand-built (see `phases.md`, Phase 3); buttons and spacers compiled to their components.

Why components versus shells: anything whose items come from the CMS and differ per placement (curated or filtered lists) is a page-owned shell plus a list; repeated fixed structures are components.

## Around the theme

- **Filters** used query parameters named after each taxonomy; a shim in the page script keeps old links and tag links working.
- **Forms** were embedded by a provider's shortcode; the plugin stayed active locally so the shortcode rendered, with its tracking blocked.
- **The cookie banner** came from the form provider's tracking script, configured per domain in the provider's settings.
- **The SEO plugin** printed a breadcrumb list and Open Graph tags on every page; Webflow templates print neither until you add them.
- **Search** was a plugin with its own results path and query parameter, redirected to Webflow's `/search?query=`.
