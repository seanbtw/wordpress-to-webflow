# Webflow limits and workarounds

Observed in November 2026 through the Webflow Data API v2 and the Webflow MCP (with its Designer "Bridge" app), on a Premium site plan. Webflow changes; several of these flipped within a day. Before relying on one, re-test it with a throwaway write, and record what you find in `LEARNINGS.md`.

## Contents
- Words and tools used here
- Write conflicts: the rules that prevent them
- Styles and selectors
- Breakpoints
- Building elements (WHTML and the element builder)
- Collection Lists
- Components, props, slots and variants
- Binding CMS fields
- Pages, templates and head code
- Site search
- Sitemap, indexing and publishing
- Driving the Designer
- CSS behaviours that surprise

## Words and tools used here

- **Headless**: a call made with no Designer tab open. Data tools work headless; some settings only write with the Designer open on the site and the MCP Bridge app launched in it (Apps panel › Webflow MCP Bridge App › Launch App).
- **WHTML**: the MCP's HTML-in builder (`data_whtml_builder`), which turns an HTML string plus a css block into Webflow elements. Fast for static markup, weaker for anything you must write to later.
- **Element builder**: `data_element_builder`, which creates elements one tree at a time by type. Slower, but its elements stay writable.
- **Tools named below**: `data_element_tool` (query, move, `set_text`, `set_tag`), `data_element_settings_tool` (`set_settings`, `get_settings`, `get_bindable_sources`; takes `scope_component_id` for elements inside a component definition), `data_style_tool` (`create_style`, `update_style`, `remove_properties`), `data_component_builder` and `data_component_tool` (`transform_element_to_component`, `insert_in_slot`, `set_component_instance_prop_values`, `get_component_instance_props`), `data_pages_tool` (`create_page` with `duplicateOf`, `set_page_freeform_code`), `data_cms_tool`, `data_sitemap_tool`, `designer_tool` (`get_selected_element`, select). Call `webflow_guide_tool` once per session first. Tool and action names drift between MCP versions; check the tool list if one is refused.

## Write conflicts: the rules that prevent them

The costliest fault met was `[Conflict] … component map`: attribute, text and settings writes refused on new and recently edited pages while styles, inserts and publishing kept working. Restoring a backup from just before the first failure did not clear it; restoring an earlier one did. The exact trigger was never isolated, but the fault never recurred under these rules:

- **Within one structure (a card, a list, a section), all API writes first, Designer steps last.** Once the Designer changes something inside an API-built structure, the API may refuse later writes to that structure's WHTML-built elements, and a binding written just before the Designer step can vanish. Element-builder elements in the same structure stayed writable, so use the element builder for anything that may need writes afterwards.
- **After any Designer reload, relaunch the MCP Bridge app** before any further write or Designer action. Otherwise API writes land on the server while the open Designer holds a stale copy and can save over them. A new MCP session id also drops the Bridge. Closing the Bridge popup with its × disconnects it.
- **Never build a Collection List inside a component definition by API.**
- **Never remove a Collection List's Empty State**: the whole list is deleted, silently. Hide it with a `display: none` class.
- **Configure a nested list completely before moving it into a slot** (source, classes, bindings, empty state). The API refuses edits to elements inside an instance's slot; change them later in the Designer.
- **Canary write after every structural step** to components, slots or lists: one throwaway attribute write, and stop at the first conflict.
- **Named manual backup before risky component work.** A restore leaves CMS items untouched but can reset reCAPTCHA keys and secondary locales; Webflow adds its own pre-restore backup.
- **One agent per workspace for structural work.** Two agents driving the same account's Designer bridge at once is a suspected factor.
- A list that took a refused sort then refused all later settings writes: replace it with a fresh list rather than retrying.
- **Ruled out as causes**, so don't spend time on them: re-applying classes (it seemed to help once; coincidence), unregistering the suspect component, the API token's scope (the Designer's own attribute panel showed the same error), and a WHTML image with no managed asset. Rebuilding the same steps one at a time with a canary after each did not reproduce it.

## Styles and selectors

- **No tag selectors headless** (`html`, `body`, `h1`–`h6`, `p`, `ul`): tag defaults and the theme's global margins go in the site CSS file.
- **No nested or descendant selectors headless.** Rich-text child styling goes in the CSS file. The Designer canvas does not load site custom code, so rich text looks unstyled there; published pages are right.
- **A combo's base value beats its parent's breakpoint values** (`.a.b{}` outranks `.a` inside a media query). Repeat smaller breakpoints on a combo only when they must differ.
- **Global paragraph and heading margin rules beat element classes.** Where the theme forces a margin to zero, mirror it with `!important` in the CSS file.
- An `update_style` with a breakpoint id the site doesn't have is accepted silently and does nothing.
- A component variant renders its class only when it carries a style; the class lands on the styled element itself (`.cls.w-variant-<id>`).

## Breakpoints

Webflow has base plus 991, 767 and 479. Read the theme's real screens (a Tailwind theme's are often custom, not Tailwind's defaults). Steps at widths Webflow lacks (for example 1200 and 1500) go in the CSS file under a media query, or for lengths use a switch that needs no media query:

```css
/* adds Δ from 1200px up, 0 below */
padding-left: calc(BASE + clamp(0px, (100vw - 1199.99px) * 1000000, Δ));
```

The multiplier must be large (10,000 was too small for percentage steps). Measure both sides of every breakpoint: 479/480, 767/768, 991/992, and each custom step.

## Building elements (WHTML and the element builder)

- **WHTML keeps only classes that already exist as styles.** A new name is silently dropped, except as a combo on an existing base. Don't rely on WHTML's css block to create classes: create every style first (`create_style`), then insert, or set the class afterwards with `set_style`.
- **WHTML stacked classes become a combo of the first class** (`class="a b"` → `.a.b`). Put independent classes on nested elements.
- **WHTML turns `<button>` into a link with no href** (not focusable). Build real buttons with the element builder: a DOM element with tag `button`.
- **WHTML keeps `data-*` attributes, links and `<strong>`**, so page sections can be inserted as HTML with placeholder divs where components go.
- **Inline spans**: the element builder cannot make a `<span>` and `set_tag` refuses it, but WHTML turns `<p><span class="x">…</span></p>` into a real Paragraph › Span with the existing class.
- **Block elements cannot be `<span>`**, and a div inside a Paragraph breaks the HTML (the browser closes the `<p>`).
- **Webflow drops empty-valued custom attributes on publish** (`data-x=""`). Give flags a value.
- **Placeholder text survives**: a TextBlock made inside a builder tree keeps "This is some text inside of a div block." and `set_text` on it is refused; set the text on its String child (find them with an element query filtered by type `String` and that text). Grep published HTML for the placeholder.
- **Long builder calls get cut off** around 4–5 KB when they carry escaped SVG. Use single-quoted attributes, smaller calls, or create an empty embed and set its code afterwards. Repeated decorative icons are cheaper as CSS pseudo-elements.
- **Duplicated pages keep element ids**: build one page shell and duplicate it; every page's main element then has the same id.
- **A page and a folder can share a slug** (`/about` and `/about/team` publish together). A folder index page with slug `index` is refused.
- **Designer copy and paste is the only way to reuse a built block** (there is no API copy). Pasted lists keep source, curated ids, sort and bindings. A block pasted onto a selected empty div lands inside it. A list cannot be pasted beside another list; paste into the parent, then `move_element`. A pasted subtree's ids keep a fixed offset layout, so one query per page gives every id.

## Collection Lists

- **Source by API**: `set_settings` key `source` with `{"collectionId": "…"}` as JSON (a plain string is refused). Nested source is `{collectionId, fieldId}`.
- **Sort and filters** have at times needed the Designer open, and at times been refused outright. Formats: sort `[{fieldSlug, direction: "ascending"}]`; filters `[{fieldSlug, operator, value}]`, with date operators `isSet`, `isNotSet`, `greaterThanOrEqual`, `lessThanOrEqual`. Keep a Designer step in reserve.
- **Curated lists**: `queryMode` is `dynamic` or `curated`. Write `queryMode: "curated"` and `curatedItemIds` in **separate** calls (together, the ids are dropped) and read back with `get_settings`. A nested source reads back as `{collectionId}` only, so a read cannot confirm the field; check the published page.
- **The item cap is `limit`, not `pagination`** (pagination turns on pager links).
- **Nested lists** show 5 items by default (raise `limit`, max 20), cannot be sorted, and show the multi-reference field's stored order. Store references in display order at import.
- **Limits**: 100 items per list; Webflow also caps Collection Lists per page (40, of which 10 nested, when this was written; check the current figures). For more than 100 items, add a second list with an offset, or paginate and load.
- **A list's source cannot be changed once its item template has bindings.**
- **Multi-image fields are Designer-only** as a list source and as an image binding.
- **"Related to this item" cannot be expressed as a filter.** List every item on the template and let a script keep the related ones (tag each with its link), computing the related set at view time from lists the template already holds. Hide the band when none are left.
- **A filter "equals the current item" is refused by API** (it wants an item id), and the Designer's own Add filter raised the conflict on an API-built list. What worked: a multi-reference field on the parent item filled by script, and a list bound to that field as its source (`{collectionId, fieldId}`).
- **Curated items cannot vary per component instance**, so anything whose items differ per placement is a page-owned shell around a list, not a component.

## Components, props, slots and variants

- **Rule of thumb**: repeated fixed structures are components; anything whose items come from the CMS and differ per placement is a page-owned shell plus a Collection List of a card component.
- **Instance props bind to CMS fields by API**: `{prop_id, type: "bindable", binding_source_type: "cms", binding_collection_id, binding_field_id}` (not a nested `binding` object).
- **Prop value types**: text content, image (asset id), alt text and variant (variant id) all take `type: "string"`; links take `type: "link"` with `link_mode` and `link_to`; booleans `type: "boolean"`; rich text `type: "richText"`, which accepts plain text only and drops span classes (carry the face with a variant plus CSS).
- **Slots**: `insert_in_slot`, or one insert with a nested `component_schema.slots` tree, works. Slot inserts return only `{inserted: true}`; get child ids from the parent insert's component info or a page-wide query.
- **Component definitions cannot be edited through the page tools.** Old page element ids stop resolving after `transform_element_to_component`. Element ids inside a definition are the component id with an incremented last group; read them with `designer_tool get_selected_element` on the component canvas and write with `scope_component_id`.
- **Transforming an element to a component can leave an empty copy of the root behind** on the page, and attributes set beforehand can be lost. Re-check both.
- **Webflow refuses slots inside a Link Block.** A button with an icon slot is a div with a full-size link overlay and a visually hidden label.
- **Embed code inside a component is writable headlessly** (`set_settings` key `code` with the component scope).

## Binding CMS fields

- **Text needs block elements**: spans refuse text bindings. Use a div, inline via CSS.
- Element bindings use `set_settings` keys `text`, `richText`, `assetId`; attributes bind one by one with `value_binding` (to a CMS field, or to a component prop with `{source_type: "prop", prop_id}`).
- **Reference sub-fields** bind with `fieldId: "<refFieldId>:::<subFieldId>"`; `get_bindable_sources` lists them.
- **`{{wf …}}` placeholders typed into an embed by API publish verbatim.** They work in page and template head code (see below), not in embeds.
- **An attribute bound to an Option field is stored but not published** (text bound to the same field is). Bind a PlainText field or derive the value in script.
- **A link to "the current item"** cannot be written or read by API (a written one publishes `#` or a literal slug). Set it in the Designer: Link settings › Collection page › Current item, or bind a component's Link prop to URL Path. A URL-bound Link prop then disappears from the instance's prop list, which is how to verify it by API.

## Pages, templates and head code

- **Template head code accepts CMS placeholders by API** (`set_page_freeform_code` on the template): `{{wf {&quot;path&quot;:&quot;<field-slug>&quot;,&quot;type&quot;:&quot;PlainText&quot;\} }}`, typed exactly so, including the `&quot;` entities and the backslash before the closing brace (types PlainText, Date, ImageRef, Link). Dates render ISO 8601, images as URLs, text HTML-escaped. Fields of a referenced item render empty.
- **CMS templates print no Open Graph or Twitter tags at all unless set.** Add them in template head code with placeholders.
- **The site head and footer code API replaces the whole block.** Read it and back it up first; other people's scripts live there. A site token gets 403 on custom code without that scope; the MCP can write it.
- Static pages have a native "Schema markup" field, a safer home for per-page JSON-LD than shared head code.
- **An untouched collection template does not publish**: its item URLs 404 until the template has content.
- **Static-page text in the primary locale** can be fixed only through the Designer tools; the page DOM endpoint accepts secondary locales only.
- **Required fields** are enforced on publish, not on drafts, and existing items are not re-validated.

## Site search

- A page with slug `search` is an ordinary page; the Search Results utility page appears when a Search element is added in the Designer.
- 10 results per page by default (max 60), no pagination. The index rebuilds 12 hours after a full publish, or Designer › Settings › Search › "Index now" once an hour. Components are excluded by default.
- Result markup is a link, the URL and a snippet with `<strong>` highlights; the title is the result page's `<title>`. The placeholder, results length and empty text are not exposed to the API's settings.
- **Results can show the site name as every title.** Don't wait for it: ship a path → title list beside the bundle and let the results script fill titles.
- With no results the list is left out and only the Empty element renders; with results, the Empty element is left out.

## Sitemap, indexing and publishing

- **Sitemap membership is its own setting.** A `noindex` meta does not remove a URL from the generated sitemap, and template pages show no toggle in the Designer. Use the beta sitemap API (`data_sitemap_tool`; REST `PATCH /beta/sitemap/collections/{id}/items` and the pages equivalent) with `includeInSitemap: false`, then publish. **Saving a page's settings in the Designer resets it**: set it last and re-list the status.
- **The sitemap updates on a full site publish only.** An item published on its own is not added until then.
- Search exclusion is a separate per-page checkbox, Designer only.
- The webflow.io staging address has its own indexing switch (keep it off); check its `robots.txt`.
- **A site's "last updated" time a few seconds after "last published" is Webflow's own bookkeeping**, not a hidden edit. A later gap means someone changed something.
- Publishing ships whatever Webflow runtime script is current; a small platform update can ride along with yours.

## Driving the Designer

- **Never type into the Designer without a focused input.** Letter keys are shortcuts (a stray heading appeared).
- Keep browser automation calls to one small action and verify the result by API.
- The canvas goes stale after API edits and can show removed elements. Reload the tab, then relaunch the Bridge.
- Dragging in the Navigator needs real pointer events with pauses; a quick drag only selects.

## CSS behaviours that surprise

- `.w-richtext ul { overflow: hidden }` clips list bullets.
- A third-party slider's base class (`.swiper`: `position: relative; overflow: hidden; z-index: 1`) loads after Webflow's CSS and beats Webflow classes. Add it only where those defaults are wanted.
- `.w-embed::before/::after` are `display: table` and become flex items when the embed is `display: contents` in a flex row.
- Webflow's base does not make `<button>` inherit type the way a CSS reset does. Add `font: inherit` and letter-spacing where a real button must match the theme, but not where its own class sets type.
- A class `display` beats the `hidden` attribute. Hide script-controlled boxes with `style.display`.
- A `<p>` wrapped around a div is closed early by the browser, so the div's children become children of the parent; in a flex column they are blockified and `display: inline` does nothing.
- A flex row whose children have a 100% basis still sits side by side unless the row itself wraps.
- A theme container given "full height" inside a fixed-height block needs an explicit `height: 100%` from that block.
- `overflow: hidden` on a sticky element's parent makes the parent the sticky reference. Use `overflow: clip` when clipping is wanted.
- Safari draws its own magnifier in `input[type=search]`; reset `appearance` and the `::-webkit-search-*` parts.
- In bundle edits, never append a `//` comment to a one-line statement: it swallows the rest of the line. Use `/* */`.
