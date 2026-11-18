// heading-sequence.mjs — the page-level check to run as soon as pages and templates exist, not only at the end.
// For every path the new site serves, it reads the visible h1–h3 headings inside <main> on the local WordPress copy
// and on Webflow staging, as a visitor's browser renders them, and reports any page where the two lists differ or
// where staging does not have exactly one h1. A whole section missing from a template shows up here as a missing
// heading on every item of that type, long before anyone looks at the page.
//
// Usage:    node heading-sequence.mjs [--only substring] [--limit N] [--config site.config.json]
// Inputs:   wordpress.localOrigin, webflow.stagingOrigin
//           <verifyDir>/staging-paths.json            from staging-paths.mjs (the paths to check)
//           <inventoryDir>/urls.csv (optional)        columns path, expected_path: gives the WordPress path for a
//                                                     staging path that was renamed on purpose
//           pathRewrites (optional)                 [{ prefixRe, to }] as in page-sweep.mjs: the WordPress path
//                                                   for a staging path moved by a rule
//           checks.headings.skipWithin (optional)     headings inside these are left out on both sides; default
//                                                     "nav, footer, [aria-hidden=true]". Add slider tracks here:
//                                                     slider libraries hide off-screen slides in different ways
//           checks.headings.srOnly (optional)         class of visually hidden text (default ".sr-only"); an h1
//                                                     hidden this way on purpose still counts as the page's h1
//           checks.headings.width (optional)          viewport width, default 1440
//           checks.headings.waitMs (optional)         wait after load for script-filled sections, default 2500
//           checks.excludePathRes (optional)          paths left out
// Outputs:  <verifyDir>/heading-sequence.json and <verifyDir>/heading-sequence.md
// Exit codes: 0 every page equal with one h1; 1 a difference; 2 config or input missing.
// Network:  the local WordPress origin and the staging origin only. Trackers and form posts are blocked.
// Needs:    playwright (npm install, then npx playwright install chromium).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { opt, origin, verify, inventory, arg, readJson, readCsv } from './site.mjs';
import { guard } from './block.mjs';

const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const SKIP = opt('checks.headings.skipWithin', 'nav, footer, [aria-hidden=true]');
const SR = opt('checks.headings.srOnly', '.sr-only');
const WIDTH = opt('checks.headings.width', 1440);
const WAIT = opt('checks.headings.waitMs', 2500);
const EXCLUDE = opt('checks.excludePathRes', []).map((s) => new RegExp(s));
const only = arg('--only', null);
const limit = +arg('--limit', 0);

let paths = Object.keys(readJson(verify('staging-paths.json'), 'staging-paths.mjs'))
  .filter((p) => !EXCLUDE.some((r) => r.test(p)) && (!only || p.includes(only))).sort();
if (limit) paths = paths.slice(0, limit);

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

const browser = await chromium.launch();
async function headings(url) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 1000 } });
  await guard(ctx);
  const page = await ctx.newPage();
  let status = 0;
  try { const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 }); status = resp ? resp.status() : 0; await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); } catch { /* a slow page is still read below */ }
  await page.waitForTimeout(WAIT);
  const out = await page.evaluate(({ SKIP, SR }) => {
    const text = (e) => e.textContent.replace(/\s+/g, ' ').replace(/ /g, ' ').trim();
    const boxed = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const visible = (e) => {
      if (!boxed(e) || (SR && e.closest(SR))) return false;
      for (let x = e; x; x = x.parentElement) if (+getComputedStyle(x).opacity === 0) return false;
      return true;
    };
    const main = document.querySelector('main') || document.body;
    const heads = [...main.querySelectorAll('h1, h2, h3')].filter((e) => !(SKIP && e.closest(SKIP)) && visible(e))
      .map((e) => e.tagName.toLowerCase() + ': ' + text(e)).filter((x) => !/: $/.test(x));
    const h1 = [...document.querySelectorAll('h1')].filter((e) => boxed(e) || (SR && e.matches(SR))).map(text).filter(Boolean);
    return { heads, h1 };
  }, { SKIP, SR }).catch(() => ({ heads: [], h1: [] }));
  await ctx.close();
  return { status, ...out };
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < paths.length) {
    const p = paths[next++];
    const [wp, wf] = await Promise.all([headings(WP + wpPath(p)), headings(WF + p)]);
    const equal = JSON.stringify(wp.heads) === JSON.stringify(wf.heads);
    let firstDiff = null;
    if (!equal) for (let i = 0; i < Math.max(wp.heads.length, wf.heads.length); i++) if (wp.heads[i] !== wf.heads[i]) { firstDiff = { i, wp: wp.heads[i] ?? null, wf: wf.heads[i] ?? null }; break; }
    results.push({ path: p, wpPath: wpPath(p), wpStatus: wp.status, wfStatus: wf.status, h1: wf.h1, oneH1: wf.h1.length === 1, equal, wpCount: wp.heads.length, wfCount: wf.heads.length, firstDiff });
  }
}));
await browser.close();

results.sort((a, b) => a.path.localeCompare(b.path));
const failing = results.filter((r) => !r.equal || !r.oneH1);
const sum = { pages: results.length, sequenceEqual: results.filter((r) => r.equal).length, oneH1: results.filter((r) => r.oneH1).length, failing: failing.length };
fs.writeFileSync(verify('heading-sequence.json'), JSON.stringify({ when: new Date().toISOString(), wordpress: WP, staging: WF, sum, results }, null, 1));
const md = ['# Heading sequence', '', `${sum.pages} pages. Reference: the local WordPress copy. Checked: ${WF}.`, '',
  '| Check | Pass | Of |', '|---|---|---|',
  `| Visible h1–h3 inside main equal WordPress's, in order | ${sum.sequenceEqual} | ${sum.pages} |`,
  `| Exactly one h1 | ${sum.oneH1} | ${sum.pages} |`, '', '## Not passing', '',
  ...(failing.length ? failing.map((r) => `- \`${r.path}\`: ` + [!r.oneH1 && `h1 ×${r.h1.length}`,
    !r.equal && `differs at #${r.firstDiff?.i} (WordPress ${JSON.stringify(r.firstDiff?.wp)} / Webflow ${JSON.stringify(r.firstDiff?.wf)}; ${r.wpCount} against ${r.wfCount} headings)`,
    r.wpStatus !== 200 && `WordPress answered ${r.wpStatus}`].filter(Boolean).join('; ')) : ['None.'])];
fs.writeFileSync(verify('heading-sequence.md'), md.join('\n') + '\n');
console.log(JSON.stringify(sum));
process.exit(failing.length ? 1 : 0);
