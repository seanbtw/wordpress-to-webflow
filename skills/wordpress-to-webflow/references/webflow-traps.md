# Webflow limits and workarounds

Observed in November 2026 through the Webflow Data API v2 and the Webflow MCP (with its Designer "Bridge" app), on a Premium site plan and, in a second and a third build, on sites with no site plan. Webflow changes; several of these flipped within a day, and a few behaved differently from one build to the next (each is given where they did). Before relying on one, re-test it with a throwaway write, and record what you find in `LEARNINGS.md`.

**The rule that covers most of this file: read back what you wrote.** Many of the faults below return "success".

## Contents
- Words and tools used here
- A site with no site plan
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

## A site with no site plan

Seen on an unhosted site in a workspace on a freelancer-type plan; limits depend on the workspace, so probe rather than trust this list (`phases.md`, Phase 0).

- **Worked**: 15 collections, 372 CMS items (345 published), 37 static pages, full publishes to the webflow.io address, custom code, saving `robots.txt`.
- **Refused**: sitemap indexing controls (403, "Site plan doesn't support sitemap indexing controls"); 301 redirects (Site settings › Publishing says they are not supported on unhosted sites).
- **Site Search returns ten sample results** with a notice, so the search page can be built and laid out but not tested for real results. "Index now" and the results length wait for the plan. The ten are the same for any query and all link to `/sample-result`, so the empty state never renders and a script that filters results by type shows nothing. Test the empty state, the filters and the paging by rewriting the published HTML inside a browser test (Playwright's `page.route`), putting real paths in place of the samples, and record that real results wait for the plan.
- **A Collection List of the template's own collection published empty on a template page** ("No items found.") when built by API, with or without a sort, though the same settings rendered on a static page and on the paid site. Cause not found. Prove it early (`phases.md`, Phase 1b) and keep the listing-page route in reserve.
- **Publishing is limited to once a minute per site** (429 with a retry time), on any plan. Batch edits, then publish once.

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
- **On a page that already holds API-built component instances, list sort and curated ids were refused on a brand-new list too**, while `source`, `queryMode` and attributes on the same list kept working. Build the CMS shells and set their sort and curation *before* inserting button or other component instances on that page, or plan the number-field route from the start (see "Collection Lists").
- **Ruled out as causes**, so don't spend time on them: re-applying classes (it seemed to help once; coincidence), unregistering the suspect component, the API token's scope (the Designer's own attribute panel showed the same error), and a WHTML image with no managed asset. Rebuilding the same steps one at a time with a canary after each did not reproduce it.

## Styles and selectors

- **No tag selectors headless** (`html`, `body`, `h1`–`h6`, `p`, `ul`): tag defaults and the theme's global margins go in the site CSS file.
- **No nested or descendant selectors headless.** Rich-text child styling goes in the CSS file. The Designer canvas does not load site custom code, so rich text looks unstyled there; published pages are right.
- **A combo's base value beats its parent's breakpoint values** (`.a.b{}` outranks `.a` inside a media query). Repeat smaller breakpoints on a combo only when they must differ.
- **Global paragraph and heading margin rules beat element classes.** Where the theme forces a margin to zero, mirror it with `!important` in the CSS file.
- An `update_style` with a breakpoint id the site doesn't have is accepted silently and does nothing.
- A component variant renders its class only when it carries a style; the class lands on the styled element itself (`.cls.w-variant-<id>`). A steadier hook: Webflow prints the chosen variant on the instance root as `data-wf--<component>--variant="<variant-slug>"`.
- **`unset` and `initial` are dropped without an error.** A "stop this below the tablet width" rule written as `prop: unset` simply vanishes. Write the property's real initial value (`grid-template-columns: none`, `padding-left: 0px`, `justify-content: flex-start`, the tag's own `display`).
- **A `grid-column` or `grid-row` shorthand is stored as its start only.** A breakpoint `grid-column: auto` leaves the base `grid-column-end: span 8` in force. Write both longhands.
- **A CSS custom property in a class's CSS becomes one site-wide variable.** `--slide-width: 25%` on one slider and `28.57%` on another end up as the same value, the last one written. Write the resolved value into the rule.
- **The HTML builder takes only `:hover`, `:focus` and `:active`** ("Pseudo-class :first-child is not allowed"); other pseudo-classes go in the CSS file.
- **External `background-image: url(https://…)` is accepted and published.** Check compiled backgrounds for local-copy URLs, and compare background images when measuring, not only background colours.

## Breakpoints

Webflow has base plus 991, 767 and 479. Read the theme's real screens (a Tailwind theme's are often custom, not Tailwind's defaults). Steps at widths Webflow lacks (for example 1200 and 1500) go in the CSS file under a media query, or for lengths use a switch that needs no media query:

```css
/* adds Δ from 1200px up, 0 below */
padding-left: calc(BASE + clamp(0px, (100vw - 1199.99px) * 1000000, Δ));
```

The multiplier must be large (10,000 was too small for percentage steps). Measure both sides of every breakpoint: 479/480, 767/768, 991/992, and each custom step.

## Building elements (WHTML and the element builder)

- **WHTML needs a style behind every class.** A class that is neither an existing style nor declared in the call's `css` block is silently left off the element (a whole section lost its new classes while the existing ones survived). In the first build the css block did not reliably create classes either; in the second it did. So: give every new class a rule in the css block, even a one-property rule, or create the style first (`create_style`), and read the classes back after the insert. A structural hook the compiler invents (a row wrapper with a class and no rule) vanishes the same way and takes its layout with it: key layout CSS on a `data-*` attribute, which survives, or give the class a real rule before the insert.
- **WHTML reuses an existing style with the same class name and ignores the new CSS for it.** A recompile that produces an old name for a new element gets the old properties. Give each page its own class namespace, and when a page is patched instead of re-inserted, push changed rules with `update_style`.
- **WHTML can drop the class of `<li>` children**, so global list rules reach them. Reset them from a parent hook in the CSS file.
- **WHTML stacked classes become a combo of the first class** (`class="a b"` → `.a.b`). Put independent classes on nested elements.
- **WHTML turns `<button>` into a link** (with no href, so not focusable, in the first build; `<a href="#" class="w-button">` in the second). `w-button` brings a blue background, white text, 9px 15px padding and an inherited line height: every class on a converted button must set background, colour and padding, and the element needs `role="button"`. For a real button use the element builder (a DOM element with tag `button`), or write `<a role="button">` yourself. A text-only comparison misses this on an icon button.
- **A `<button>` that holds child spans comes out with `##INLINE0##`-style placeholders as its text** (accordion headers; the paragraphs after it can carry them too). Compile such buttons to `<div role="button" tabindex="0">` and have the script answer Enter and Space. Grep the published HTML for `##INLINE` after every insert.
- **WHTML drops the space at the edge of a text node that touches an inline element** (`contact </span><a>`, `<strong>…</strong> </span>`), which glues two words together. Mend it after the insert: `set_text` on the String child keeps a plain leading or trailing space, read back and published. Two repairs that look right and are not: a no-break space survives but ties the word to the link, so lines break in other places (one page went from 62 measured mismatches to 489); a space followed by a zero-width space wraps correctly but leaves a stray character and an extra measured text node. Run the glued-words check straight after the first page insert, not at the end, and grep published HTML for U+200B if any agent was asked to fix spacing.
- **WHTML takes one root element per insert.** A batch of `<li>` goes in as a whole `<ul>`: insert the new list beside the empty one, then remove the empty one.
- **WHTML trims attribute values** (`data-suffix=" - Name"` is stored as `"- Name"`). A script that reads such a value must not depend on its outer spaces.
- **WHTML drops an `<img>` whose file is not in the asset library** (it keeps an empty Image element), even for a Webflow CDN URL. Upload first, then `set_image_asset`.
- **An `<a>` with block children becomes a Link Block, which is `inline-block`** where the theme's link was `inline`. An image sized by height inside it then takes its natural ratio. Set the link back to inline where the theme relies on it.
- **`<div class="w-richtext">` in WHTML becomes a plain Block.** Create Rich Text with the element builder (`type: "RichText"`) and bind it with key `richText`.
- **WHTML keeps `data-*` attributes, links and `<strong>`**, so page sections can be inserted as HTML with placeholder divs where components go.
- **Inline spans**: the element builder cannot make a `<span>` and `set_tag` refuses it, but WHTML turns `<p><span class="x">…</span></p>` into a real Paragraph › Span with the existing class.
- **Block elements cannot be `<span>`**, and a div inside a Paragraph breaks the HTML (the browser closes the `<p>`).
- **Webflow drops empty-valued custom attributes on publish** (`data-x=""`). Give flags a value.
- **Placeholder text survives**: a TextBlock made inside a builder tree keeps "This is some text inside of a div block." and `set_text` on it is refused; set the text on its String child (find them with an element query filtered by type `String` and that text). Grep published HTML for the placeholder.
- **Long builder calls get cut off** around 4–5 KB when they carry escaped SVG. Use single-quoted attributes (a 17 KB list of 37 items, each with an SVG, then went in whole), smaller calls, or create an empty embed and set its code afterwards. Repeated decorative icons are cheaper as CSS pseudo-elements.
- **Duplicated pages keep element ids**: build one page shell and duplicate it; every page's main element then has the same id.
- **A page and a folder can share a slug** (`/about` and `/about/team` publish together). A folder index page with slug `index` is refused. A folder made by `create_page_folder` is named "Untitled"; rename it with `update_page_settings` (title and slug), which works on folders.
- **Designer copy and paste is the only way to reuse a built block** (there is no API copy). Pasted lists keep source, curated ids, sort and bindings. A block pasted onto a selected empty div lands inside it. A list cannot be pasted beside another list; paste into the parent, then `move_element`. A pasted subtree's ids keep a fixed offset layout, so one query per page gives every id.

## Collection Lists

- **Source by API**: `set_settings` key `source` with `{"collectionId": "…"}` as JSON (a plain string is refused). Nested source is `{collectionId, fieldId}`, where `collectionId` is the **referenced** collection and `fieldId` the multi-reference field on the parent; the parent collection's own id is refused ("not a valid source"). The nested list must already sit inside the parent's list item when its source is set: create it there, or set the source after moving it in.
- **Sort and filters** have at times needed the Designer open, and at times been refused outright. In the second build they worked headless on a clean page, and were refused with `[Conflict] … component map` on a page full of API-built component instances, even with the Designer open on it: build CMS shells on their real pages, not on a component test page. Formats: `limit` a number; sort `[{fieldSlug, direction: "ascending"}]`; filters `[{fieldSlug, operator, value}]`, with operators `isSet`, `isNotSet`, `greaterThanOrEqual`, `lessThanOrEqual`. Keep a Designer step in reserve.
- **A sort write can report success and store nothing.** On a page full of API-built instances the call answered `applied_keys: ["sort"]` and `get_settings` then showed `sort: []`. Read every sort back. The route that held every time: a Number field bound to an attribute on each item (the pick position for a hand-picked order, a timestamp for date order) and a script that sorts the items by it. Editors then reorder by editing the number.
- **A list cannot take `source` at creation** ("Setting "source" is not applicable"). Create it bare, set `source` first, then `sort`, `limit` and `filters` in a second call.
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
- **Two slots with the same name: only the first can be filled by API.** Both calls resolve the name to the first slot, and slot props cannot be renamed. Give a component at most one slot if it must be filled by API; drive position with a boolean prop bound to an attribute and reorder in CSS. **A boolean-bound attribute publishes as "True" or "False"**, capitalised: match with `[data-x="true" i]`.
- **Insert a component instance by appending to a parent**; an instance cannot be the anchor of an insert.
- **Component definitions cannot be edited through the page tools.** Old page element ids stop resolving after `transform_element_to_component`. Element ids inside a definition are the component id with an incremented last group; read them with `designer_tool get_selected_element` on the component canvas and write with `scope_component_id`.
- **Transforming an element to a component can leave an empty copy of the root behind** on the page, and attributes set beforehand can be lost. Re-check both.
- **Webflow refuses slots inside a Link Block.** A button with an icon slot is a div with a full-size link overlay and a visually hidden label.
- **Embed code inside a component is writable headlessly** (`set_settings` key `code` with the component scope).

## Binding CMS fields

- **Text needs block elements**: spans refuse text bindings. Use a div, inline via CSS. A bound value therefore cannot sit inside a theme `<p>` (a block inside a paragraph): turn that `<p>` into a div that carries the paragraph's measured type.
- Element bindings use `set_settings` keys `text`, `richText`, `assetId`; attributes bind one by one with `value_binding` (to a CMS field, or to a component prop with `{source_type: "prop", prop_id}`).
- **Bindings cannot be set while the element is being created.** The element builder refuses `attributes` and CMS `text` bindings in its `settings` ("not applicable", "not inside a CMS context"); the same writes succeed with `set_settings` once the element sits inside the Collection Item. Create first, bind second, read back third.
- **Attribute bindings by API**: `set_settings [{key: "attributes", attributes: [{name_static, value_static} | {name_static, value_binding: {source_type: "cms", collection_id, field_id}}]}]`. The call replaces the element's whole attribute list, so pass the static ones too. Useful where a collection has no link field to bind (bind the slug to an attribute and let a script build the href). **`href` is refused in that list** ("reserved attribute name") even though WHTML stored it as an attribute on the same link: leave it out when rewriting a link's attributes.
- **Visibility binds only to Switch fields**, and a visibility write can report success and store nothing (it did on two HTML-built wrapper Blocks; the same binding on a Span and a Link held). Read every one back with `get_settings`. A PlainText field is refused with the misleading "Element is not inside a CMS context". Where no Switch exists, hide the wrapper in CSS with `:has(.w-dyn-bind-empty)`.
- **A CMS-bound image keeps its static alt.** Every item then shows the first item's alt, or none. Set `altText` to `"inherit"` (`set_settings [{key: "altText", static_text: {value: "inherit"}}]`) so it follows each item's image.
- **Color fields are not bindable by API**, as text or as a style. Keep a plain-text copy of the colour.
- **The built-in Created On and Published On are not bindable by API** (`get_bindable_sources` lists collection fields only; `fieldId: "created-on"` answers "CMS field not found"). An item an editor makes cannot be placed by its creation time, so order on the date field editors fill and treat an item with no date as the newest.
- **Bind the box WordPress has, not one inside it.** A bound value one level deeper than the theme's text element (rich text inside a faded wrapper, a value div inside a tag span) measures as opacity and box mismatches although it looks the same. Bind the tag's own box, and move a wrapper's opacity onto the rich text.
- **Don't put `display: contents` on a bound rich text.** It then has no box of its own, and a position-based measurement shifts every later element. Style the rich text block itself.
- **`data-tag-1` is `dataset['tag-1']`**, not `dataset.tag1` (no camel-casing before a digit). Read such attributes with `getAttribute`.
- **Reference sub-fields** bind with `fieldId: "<refFieldId>:::<subFieldId>"`; `get_bindable_sources` lists them.
- **`{{wf …}}` placeholders typed into an embed by API publish verbatim.** They work in page and template head code (see below), not in embeds.
- **An attribute bound to an Option field is stored but not published** (text bound to the same field is). Bind a PlainText field or derive the value in script.
- **A link to "the current item"** cannot be written or read by API (a written one publishes `#` or a literal slug). Set it in the Designer: Link settings › Collection page › Current item, or bind a component's Link prop to URL Path. A URL-bound Link prop then disappears from the instance's prop list, which is how to verify it by API.

## Pages, templates and head code

- **Template head code accepts CMS placeholders by API** (`set_page_freeform_code` on the template): `{{wf {&quot;path&quot;:&quot;<field-slug>&quot;,&quot;type&quot;:&quot;PlainText&quot;\} }}`, typed exactly so, including the `&quot;` entities and the backslash before the closing brace (types PlainText, Date, ImageRef, Link). Dates render ISO 8601, images as URLs, text HTML-escaped. Fields of a referenced item render empty.
- **CMS templates print no Open Graph or Twitter tags at all unless set.** Add them in template head code with placeholders. **The Open Graph image setting itself takes a URL only by API** (a CMS placeholder is refused), so print `og:image` in head code from a field, with its width, height and type from fields beside it. An item whose field is empty then prints an empty `og:image`: make the field required, or bind the image in the Designer afterwards (Page settings › Open Graph). Compare `og:image` on every item with WordPress's (`scripts/seo-check.mjs`); tag presence on one page is not a check.
- **The site head and footer code API replaces the whole block.** Read it and back it up first; other people's scripts live there. A site token gets 403 on custom code without that scope; the MCP can write it.
- Static pages have a native "Schema markup" field, a safer home for per-page JSON-LD than shared head code.
- **An untouched collection template does not publish**: its item URLs 404 until the template has content. A collection made by API gets a template with only a Body, so add at least the navigation and footer to every template.
- **Webflow ignores query strings on `/`.** `/?p=<id>` always serves the home page with 200; no page or redirect can match it. Record it as an accepted difference.
- **The 404 page has no id in the page list until it has been opened once in the Designer**, and the Search Results page does not exist until a Search element has been added (it can be deleted again). After those two clicks both are built like any page. Make the clicks yourself through the browser at the start of the build.
- **The site icon is one upload** (Site settings › General › Icons): one square image becomes the favicon, the touch icon and the larger app icons. There is no API route.
- **Static-page text in the primary locale** can be fixed only through the Designer tools; the page DOM endpoint accepts secondary locales only.
- **Required fields** are enforced on publish, not on drafts, and existing items are not re-validated.

## Site search

- A page with slug `search` is an ordinary page; the Search Results utility page appears when a Search element is added in the Designer.
- On a site with no site plan, search shows sample results only (see "A site with no site plan").
- **Attributes cannot be set on the native search input** (`set_attributes` for `placeholder` answers "An internal error occurred"; `set_style` on it works). Set the placeholder from the script at run time.
- 10 results per page by default (max 60), no pagination. The index rebuilds 12 hours after a full publish, or Designer › Settings › Search › "Index now" once an hour. Components are excluded by default.
- Result markup is a link, the URL and a snippet with `<strong>` highlights; the title is the result page's `<title>`. The placeholder, results length and empty text are not exposed to the API's settings.
- **Results can show the site name as every title.** Don't wait for it: ship a path → title list beside the bundle and let the results script fill titles. If the script finds that list from the bundle's own address, take the bundle's file name from the config: a name carried over from the last site finds nothing.
- With no results the list is left out and only the Empty element renders; with results, the Empty element is left out.

## Sitemap, indexing and publishing

- **Sitemap membership is its own setting.** A `noindex` meta does not remove a URL from the generated sitemap, and template pages show no toggle in the Designer. Use the beta sitemap API (`data_sitemap_tool`; REST `PATCH /beta/sitemap/collections/{id}/items` and the pages equivalent) with `includeInSitemap: false`, then publish. **Saving a page's settings in the Designer resets it**: set it last and re-list the status.
- **The sitemap updates on a full site publish only.** An item published on its own is not added until then.
- Search exclusion is a separate per-page checkbox, Designer only.
- The webflow.io staging address has its own indexing switch (keep it off); check its `robots.txt`. A custom `robots.txt` can be saved before there is a plan, while staging keeps serving its own `Disallow: /`. Auto-generate sitemap adds its own Sitemap line once switched on, so if your text carries one, tick "Remove sitemap.xml from robots.txt" at cutover.
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
- With your own slide class (`slideClass`), slides need `flex-shrink: 0`: the slider's CSS sets it on its default slide class only, so custom slides shrink to their content (card images 362px wide came out at 108px, and a slider whose shrunken slides all fitted the track would not move). Put the rule in the shared stylesheet the kit starts from, not in one site's.
- **A rule that hides helper lists by a shared attribute hides every later list given that attribute.** Give a nested list that must show its own hook.
- `.x input { font: inherit }` outranks a type class on the input (two selectors against one). Leave the font to the class.
- `.w-embed::before/::after` are `display: table` and become flex items when the embed is `display: contents` in a flex row.
- Webflow's base does not make `<button>` inherit type the way a CSS reset does. Add `font: inherit` and letter-spacing where a real button must match the theme, but not where its own class sets type.
- A class `display` beats the `hidden` attribute. Hide script-controlled boxes with `style.display`.
- A `<p>` wrapped around a div is closed early by the browser, so the div's children become children of the parent; in a flex column they are blockified and `display: inline` does nothing.
- A flex row whose children have a 100% basis still sits side by side unless the row itself wraps.
- A theme container given "full height" inside a fixed-height block needs an explicit `height: 100%` from that block.
- `overflow: hidden` on a sticky element's parent makes the parent the sticky reference. Use `overflow: clip` when clipping is wanted.
- Safari draws its own magnifier in `input[type=search]`; reset `appearance` and the `::-webkit-search-*` parts.
- In bundle edits, never append a `//` comment to a one-line statement: it swallows the rest of the line. Use `/* */`.
