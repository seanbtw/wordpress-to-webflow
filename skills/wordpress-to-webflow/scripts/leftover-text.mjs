// leftover-text.mjs — finds text on the new site that nobody wrote: the HTML builder's placeholders and Webflow's
// default text. It reads each published page's own HTML, so text in an element that is hidden until hover, inside
// a closed panel, or read only by a screen reader is found too. One build shipped "This is some text inside of a div
// block." in a pill that shows on hover, and another a "##INLINE12##" in a paragraph; neither moved a pixel at rest.
//
// Usage:    node leftover-text.mjs --all [--conc 6] [--limit N] [--config site.config.json]
//           node leftover-text.mjs /about /contact
// Inputs:   webflow.stagingOrigin
//           <verifyDir>/staging-paths.json            from staging-paths.mjs (with --all)
//           checks.excludePathRes (optional)          paths left out
//           checks.leftovers.extra (optional)         more strings to look for (a list), e.g. a sample name used
//                                                     while building
//           checks.leftovers.allow (optional)         strings from the lists below that are real copy on this site
// Outputs:  <verifyDir>/leftover-text.json and <verifyDir>/leftover-text.md
//           The count of pages read goes to standard error.
// Exit codes: 0 nothing found; 1 something found or a page could not be read; 2 config missing or no path given.
// Network:  the staging origin only, plain page requests. No script on the page runs.
// Needs:    Node 18 or later (built-in fetch). No packages.
// What it looks for:
//   - placeholders the HTML builder leaves where it could not keep an element: ##INLINE0##, ##BLOCK3## and the like
//   - Webflow's default text, anywhere: the Text Block sentence, the Rich Text sample heading, Lorem ipsum
//   - Webflow's sample search results (links to /sample-result), printed into a Search Results element on a site
//     with no search index. Expected while the site has no plan: record it as waiting for the plan, and run this
//     again after cutover and "Index now", when it must find none
//   - Webflow's default labels as the whole text of an element: "Heading", "Button Text", "Text Link", "Link"
import fs from 'node:fs';
import { opt, origin, arg, has, positionals, verify, readJson } from './site.mjs';

const WF = origin('webflow.stagingOrigin');
const CONC = +arg('--conc', 6);
const ALLOW = new Set(opt('checks.leftovers.allow', []));
const ANYWHERE = ['This is some text inside of a div block.', 'What’s a Rich Text element?', "What's a Rich Text element?", 'Lorem ipsum dolor sit amet', ...opt('checks.leftovers.extra', [])].filter((s) => !ALLOW.has(s));
const WHOLE = ['Heading', 'Button Text', 'Text Link', 'Link'].filter((s) => !ALLOW.has(s));
const PLACEHOLDER = /##[A-Z]+\d+##/g;

let pages = positionals(['--conc', '--limit']);
if (has('--all')) {
  const EXCLUDE = opt('checks.excludePathRes', []).map((s) => new RegExp(s));
  pages = Object.keys(readJson(verify('staging-paths.json'), 'staging-paths.mjs')).filter((p) => !EXCLUDE.some((r) => r.test(p))).sort();
}
pages = pages.slice(0, +arg('--limit', 1e9));
if (!pages.length) { console.error('leftover-text: give at least one path, or --all. For example: node leftover-text.mjs --all'); process.exit(2); }

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function scan(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const found = [];
  const near = (i, n) => decode(body.slice(Math.max(0, i - 60), i + n + 60).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  for (const m of body.matchAll(PLACEHOLDER)) found.push({ what: m[0], kind: 'placeholder', near: near(m.index, m[0].length) });
  // Webflow prints sample results into a Search Results element when the site has no search index (no hosting plan
  // yet). A script that fills the list afterwards hides them from a visitor's eye, not from the page's HTML.
  const samples = (body.match(/href="\/sample-result"/g) || []).length;
  if (samples) found.push({ what: `${samples} sample search results`, kind: 'Webflow sample search result', near: 'links to /sample-result inside the Search Results element' });
  // tags out, and the spaces a tag-per-word markup leaves before punctuation closed up
  const text = decode(body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/ ([,.;:!?…])/g, '$1');
  for (const s of ANYWHERE) { let i = -1; while ((i = text.indexOf(s, i + 1)) >= 0) found.push({ what: s, kind: 'default text', near: text.slice(Math.max(0, i - 60), i + s.length + 60).trim() }); }
  // an element whose whole text is a default label: <h2 class="…">Heading</h2>, <a …>Text Link</a>
  for (const m of body.matchAll(/<(h[1-6]|a|button|div|p|span)\b([^>]*)>\s*([^<]{1,20}?)\s*<\/\1>/gi)) {
    const t = decode(m[3]).trim(); if (!WHOLE.includes(t)) continue;
    if (t === 'Heading' && !/^h[1-6]$/i.test(m[1])) continue;                 // "Heading" only as a heading's whole text
    if (t === 'Link' && !/^a$/i.test(m[1])) continue;                         // "Link" only as a link's whole text
    found.push({ what: t, kind: 'default label', near: `<${m[1]}${m[2].slice(0, 80)}>` });
  }
  return found;
}

const res = []; const jobs = [...pages];
await Promise.all([...Array(CONC)].map(async () => { while (jobs.length) { const p = jobs.shift(); let status = 0, found = [];
  for (let attempt = 0; attempt < 2 && status !== 200 && status !== 404; attempt++) { try { const r = await fetch(WF + p, { redirect: 'follow' }); status = r.status; if (status === 200) found = scan(await r.text()); } catch { status = 0; } if (status !== 200 && status !== 404) await new Promise((r) => setTimeout(r, 3000)); }
  res.push({ path: p, status, found }); if (found.length) console.log(`${p}: ${found.map((f) => f.what).join(', ')}`); } }));
res.sort((a, b) => a.path.localeCompare(b.path));
const read = res.filter((r) => r.status === 200), bad = res.filter((r) => r.status !== 200), hits = read.flatMap((r) => r.found.map((f) => ({ ...f, path: r.path })));
fs.writeFileSync(verify('leftover-text.json'), JSON.stringify(res, null, 1));
const cell = (s) => String(s).replace(/\|/g, '/');
fs.writeFileSync(verify('leftover-text.md'), ['# Leftover text on staging', '', `${read.length} of ${res.length} pages read · ${hits.length} found on ${new Set(hits.map((h) => h.path)).size} pages${bad.length ? ' · not read: ' + bad.map((r) => `${r.path} (${r.status})`).join(', ') : ''}`, '',
  '| Page | Kind | Text | Around it |', '|---|---|---|---|', ...hits.map((h) => `| ${h.path} | ${h.kind} | ${cell(h.what)} | ${cell(h.near).slice(0, 160)} |`)].join('\n') + '\n');
console.error(`leftover-text: ${read.length} of ${res.length} pages read, ${hits.length} found → ${verify('leftover-text.md')}`);
process.exit(hits.length || bad.length ? 1 : 0);
