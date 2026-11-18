// glued-words.mjs — finds words that are glued together on Webflow but are two words on WordPress (a space at the
// edge of a text node lost when the page or a rich-text body was built). It reads the text of the same page on both
// sides and reports Webflow words that equal two adjacent WordPress words and that WordPress never prints as one.
//
// Two ways of reading the text:
//   default      the served HTML, tags stripped. Fast, no browser. Links that sit side by side in the markup with no
//                whitespace between them (navigation, footer) read as one word here although they render apart.
//   --rendered   the text a browser shows inside <main> (innerText). Slower, needs Playwright, and does not trip on
//                adjacent links. Use this one for the run over every page.
//
// Usage:    node glued-words.mjs /path [/path …] [--rendered] [--config site.config.json]
//           node glued-words.mjs --all --rendered        every path in staging-paths.json
// Inputs:   wordpress.localOrigin, webflow.stagingOrigin
//           <verifyDir>/staging-paths.json (with --all)   from staging-paths.mjs
//           <inventoryDir>/urls.csv (optional)            columns path, expected_path: gives the WordPress path for a
//                                                         staging path that was renamed on purpose
//           pathRewrites (optional)                     [{ prefixRe, to }] as in page-sweep.mjs: the WordPress path
//                                                       for a staging path moved by a rule
//           checks.excludePathRes (optional, with --all)  paths left out
//           checks.glued.within (optional, --rendered)    selector whose text is read, default "main" (else body)
//           checks.glued.skipWithin (optional, --rendered) selector removed first, default ".sr-only"
// Outputs:  JSON on standard output: { "/path": ["gluedWord", …] } (up to 8 per page), or "fetch failed" for a path
//           that did not answer 200 on both sides. An empty object means nothing was found. The count of pages
//           compared goes to standard error, so a run that compared nothing is plain to see.
// Exit codes: 0 nothing glued; 1 something glued or a page could not be fetched; 2 config missing or no path given.
// Network:  the local WordPress copy and the staging origin. A 429 is waited out and retried. With --rendered,
//           trackers and form posts are blocked.
// Needs:    playwright for --rendered only (npm install, then npx playwright install chromium).
import fs from 'node:fs';
import { opt, origin, positionals, has, verify, inventory, readJson, readCsv } from './site.mjs';

const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const RENDERED = has('--rendered');

const BLOCK = /<\/?(p|div|h[1-6]|li|ul|ol|br|section|article|td|tr|table|header|footer|nav|figure|figcaption|blockquote|main|button|img)\b[^>]*>/gi;
const strip = (h) => h.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(BLOCK, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#\d+;|&[a-z]+;/g, '');
// one spelling for quotes and spaces on both sides; a zero-width space is not a space
const tokens = (t) => t.replace(/​/g, '').replace(/ /g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').split(/\s+/).filter(Boolean);

const get = async (u) => {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u);
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 4000)); continue; }
    return r.status === 200 ? r.text() : '';
  }
  return '';
};

let paths = positionals();
if (has('--all')) {
  const EXCLUDE = opt('checks.excludePathRes', []).map((s) => new RegExp(s));
  paths = Object.keys(readJson(verify('staging-paths.json'), 'staging-paths.mjs')).filter((p) => !EXCLUDE.some((r) => r.test(p))).sort();
}
if (!paths.length) { console.error('glued-words: give at least one path, or --all. For example: node glued-words.mjs /about /blog/a-post --rendered'); process.exit(2); }

// staging path -> WordPress path, for pages renamed on purpose
const bare = (p) => (p.split('?')[0].replace(/\/+$/, '') || '/');
const wpPathFor = {};
const urlsFile = inventory('urls.csv');
// Rows whose expected path carries a query are left out (an archive folded into a filtered listing would otherwise claim
// the listing's own path), and a row whose WordPress path is the same page wins over an earlier row.
if (fs.existsSync(urlsFile)) for (const r of readCsv(urlsFile)) {
  if (!r.expected_path || !r.path || r.expected_path.includes('?')) continue;
  const k = bare(r.expected_path); if (bare(r.path) === k || !(k in wpPathFor)) wpPathFor[k] = r.path;
}
// the same rule page-sweep.mjs and colour-check.mjs read, so every check compares a moved page with the same WordPress page
for (const r of opt('pathRewrites', [])) if (r.prefixRe && r.to && !(bare(r.to) in wpPathFor)) wpPathFor[bare(r.to)] = r.prefixRe.replace(/^\^/, '').replace(/\/\?\$?$/, '').replace(/\$$/, '') + '/';
const wpPath = (p) => wpPathFor[bare(p)] || (p === '/' ? '/' : p.replace(/\/+$/, '') + '/');

let browser = null, ctx = null;
if (RENDERED) {
  const { chromium } = await import('playwright');
  const { guard } = await import('./block.mjs');
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await guard(ctx);
}
const WITHIN = opt('checks.glued.within', 'main');
const SKIP = opt('checks.glued.skipWithin', '.sr-only');
const rendered = async (url) => {
  const page = await ctx.newPage();
  try {
    const r = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    if (!r || r.status() !== 200) return '';
    await page.waitForTimeout(400);
    return await page.evaluate(({ WITHIN, SKIP }) => {
      const m = document.querySelector(WITHIN) || document.body;
      m.querySelectorAll('script, style, noscript' + (SKIP ? ', ' + SKIP : '')).forEach((e) => e.remove());
      return m.innerText;
    }, { WITHIN, SKIP });
  } catch { return ''; } finally { await page.close(); }
};
const read = async (url) => (RENDERED ? rendered(url) : strip(await get(url)));

const out = {};
let compared = 0;
const queue = [...paths];
await Promise.all(Array.from({ length: RENDERED ? 4 : 2 }, async () => {
  while (queue.length) {
    const p = queue.shift();
    const [a, b] = await Promise.all([read(WP + wpPath(p)), read(WF + p)]);
    if (!a || !b) { out[p] = 'fetch failed'; continue; }
    compared++;
    const A = tokens(a), one = new Set(A), pairs = new Set();
    for (let i = 0; i < A.length - 1; i++) pairs.add(A[i] + A[i + 1]);
    const glued = [...new Set(tokens(b))].filter((w) => !one.has(w) && pairs.has(w) && w.length > 3);
    if (glued.length) out[p] = glued.slice(0, 8);
  }
}));
if (browser) await browser.close();
console.error(`glued-words: ${compared} of ${paths.length} pages compared (${RENDERED ? 'rendered text' : 'served HTML'}); ${Object.values(out).filter((v) => Array.isArray(v)).length} with glued words.`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 1));
process.exit(Object.keys(out).length ? 1 : 0);
