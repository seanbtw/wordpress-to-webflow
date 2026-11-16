// compare-bodies.mjs — compares the rendered body of a post on the local WordPress copy with the same item's
// rich-text body on Webflow staging: the text, the number of images and iframes, and the set of links. It also saves
// a screenshot of each body. Links are normalised before comparing: the old hosts are dropped, the config's path
// rewrites are applied, and an old uploads URL becomes the file's new URL when the media manifest knows it.
//
// Usage:    node compare-bodies.mjs <type> <slug> [<slug> …] [--wp-selector ".css"] [--config site.config.json]
//           The page is loaded at <webflow.stagingOrigin>/<type>/<slug>, and on WordPress at the address urls.csv
//           gives for that staging path (columns path, expected_path), else <wordpress.localOrigin>/<type>/<slug>/.
//           Needs the template to be published, so it runs from Phase 4 on; the converter's own comparison of its
//           output is the Phase 2 check.
// Inputs:   wordpress.localOrigin, webflow.stagingOrigin, site.liveOrigin
//           checks.bodies.wpSelector          CSS selector of the body in the WordPress theme
//           checks.bodies.wpSelectorByType    (optional) { "<type>": "selector" } where a post type's body differs
//           checks.bodies.wfSelector          CSS selector of the rich-text body on Webflow
//           pathRewrites (optional), <inventoryDir>/media-manifest.json (optional)
// Outputs:  <verifyDir>/bodies/rendered-compare-<type>.json and <slug>-wp.png / <slug>-webflow.png; the same JSON
//           is printed.
// Exit codes: 0 every body matches; 1 a text, media-count or link difference, or a body not found; 2 config missing
//           or no type and slug given.
// Network:  the local WordPress copy and the staging origin (trackers are blocked: see block.mjs).
// Needs:    playwright and cheerio (npm install, then npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';
import { need, opt, origin, inventory, verify, arg, positionals, readCsv } from './site.mjs';
import { guard } from './block.mjs';

const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const LIVE_ORIGIN = origin('site.liveOrigin');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LOCAL_HOST = WP.replace(/^https?:\/\//, '');
const BARE_HOST = LIVE_ORIGIN.replace(/^https?:\/\//, '').replace(/^www\./, '');
const LOCAL = new RegExp('^https?://' + reEsc(LOCAL_HOST));
const UPLOADS = opt('wordpress.uploadsPath', '/wp-content/uploads/');
const manifestFile = opt('paths.inventoryDir', null) ? inventory('media-manifest.json') : null;
const MANIFEST = manifestFile && fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;

function applyPathRewrites(h) {
  for (const r of opt('pathRewrites', [])) {
    if (r.exact && r.exact.includes(h)) h = r.to;
    else if (r.prefixRe && new RegExp(r.prefixRe).test(h)) h = h.replace(new RegExp(r.prefixRe), r.to);
  }
  return h;
}

/** one comparable form of a link: old hosts dropped, uploads sent to their new home, decided path changes applied */
export function rewriteHref(href) {
  if (!href) return href;
  const up = href.match(new RegExp(`^(?:https?://(?:${reEsc(LOCAL_HOST)}|(?:www\\.)?${reEsc(BARE_HOST)}))?(${reEsc(UPLOADS)}[^?#]+)`));
  if (up) {
    const entry = MANIFEST && MANIFEST[decodeURIComponent(up[1].replace(UPLOADS, ''))];
    const moved = Array.isArray(entry) ? entry[0]?.destination : entry?.destination;
    return moved || LIVE_ORIGIN + up[1];
  }
  let h = href.replace(LOCAL, '').replace(new RegExp(`^https?://(www\\.)?${reEsc(BARE_HOST)}(?=/|$)`), '');
  if (h === '') h = '/';
  return applyPathRewrites(h);
}

/** text / media / link fingerprints of a body's HTML */
export function fingerprint(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`, null, false);
  $('#r .sr-only, #r script, #r style, #r svg').remove();
  $('#r').find('p,h1,h2,h3,h4,h5,h6,li,blockquote,figure,section,div,td,th,tr,br').each((i, e) => { $(e).prepend(' '); $(e).append(' '); });
  const text = $('#r').text().replace(/ /g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const media = $('#r img').length + $('#r iframe').length;
  const links = $('#r a[href]').filter((i, a) => $(a).text().trim() || $(a).find('img').length).map((i, a) => rewriteHref($(a).attr('href')).replace(/\/$/, '')).get().sort();
  return { text, media, links };
}

const [type, ...slugs] = positionals(['--wp-selector']);
// staging path -> WordPress path, for items WordPress serves at a custom address
const wpPathFor = {};
const urlsFile = opt('paths.inventoryDir', null) ? inventory('urls.csv') : null;
const bare = (p) => (p.split('?')[0].replace(/\/+$/, '') || '/');
if (urlsFile && fs.existsSync(urlsFile)) for (const r of readCsv(urlsFile)) {   // rows with a query in the expected path are left out; the same page wins
  if (!r.expected_path || !r.path || r.expected_path.includes('?')) continue;
  const k = bare(r.expected_path); if (bare(r.path) === k || !(k in wpPathFor)) wpPathFor[k] = r.path;
}
const wpPath = (t, s) => wpPathFor[`/${t}/${s}`] || `/${t}/${s}/`;
if (!type || !slugs.length) { console.error('compare-bodies: give a post type and at least one slug, for example: node compare-bodies.mjs blog my-first-post'); process.exit(2); }
const WPSEL = arg('--wp-selector', null) || opt('checks.bodies.wpSelectorByType', {})[type] || need('checks.bodies.wpSelector');
const WFSEL = need('checks.bodies.wfSelector');
const outFile = verify('bodies', `rendered-compare-${type}.json`);
const outDir = path.dirname(outFile);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await guard(ctx);
const page = await ctx.newPage();
const res = [];
for (const slug of slugs) {
  const get = async (url, sel, side) => {
    const r = await page.goto(url, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});   // a page with a live map never goes idle
    await page.evaluate(() => document.querySelector('.w-webflow-badge')?.remove());
    const html = await page.$eval(sel, (e) => e.innerHTML).catch(() => null);
    const el = await page.$(sel);
    if (el) await el.screenshot({ path: `${outDir}/${slug}-${side}.png` });
    return { status: r.status(), html };
  };
  const a = await get(WP + wpPath(type, slug), WPSEL, 'wp');
  const c = await get(`${WF}/${type}/${slug}`, WFSEL, 'webflow');
  if (a.html === null) { res.push({ slug, error: `no ${WPSEL} on WordPress`, status: a.status }); continue; }
  if (!c.html) { res.push({ slug, error: `no ${WFSEL} on staging`, status: c.status }); continue; }
  const fa = fingerprint(a.html), fc = fingerprint(c.html);
  res.push({ slug, text: fa.text === fc.text, textLen: [fa.text.length, fc.text.length], media: [fa.media, fc.media], links: JSON.stringify(fa.links) === JSON.stringify(fc.links) });
  if (fa.text !== fc.text) { let i = 0; while (fa.text[i] === fc.text[i]) i++; res.at(-1).diff = [fa.text.slice(Math.max(i - 40, 0), i + 40), fc.text.slice(Math.max(i - 40, 0), i + 40)]; }
  if (JSON.stringify(fa.links) !== JSON.stringify(fc.links)) res.at(-1).linkDiff = { wpOnly: fa.links.filter((x) => !fc.links.includes(x)), wfOnly: fc.links.filter((x) => !fa.links.includes(x)) };
}
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
await browser.close();
process.exit(res.some((r) => r.error || !r.text || !r.links || r.media[0] !== r.media[1]) ? 1 : 0);
