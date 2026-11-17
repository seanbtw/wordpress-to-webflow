// colour-check.mjs — finds text that cannot be read on the new site. Text that loses its colour (an inline colour span
// dropped by a converter, a class that sets another colour) can end up white on white: it moves almost no pixels, so
// a picture comparison passes it. Two passes over every page, the local WordPress copy against staging:
//   1. Inline colours. Every element on WordPress whose style attribute sets a colour. For one with text, the same
//      text is found on staging and the computed text colour and the colour behind it are compared. Verdicts: same
//      colour; different but readable (3:1 or more on staging); HARD TO READ (under 3:1 where WordPress had 3:1).
//   2. Invisible text. Every visible element with its own text on staging, against what is behind it. Anything under
//      1.5:1 is looked up on WordPress: readable there (3:1 or more) = a real fault.
// "Behind" is the first opaque layer under the text's first line in the paint stack; a picture or background image
// there is counted as "image" and not measured. Contrast is WCAG's relative-luminance ratio, with the text colour's
// alpha and every ancestor's opacity blended over the background.
//
// Usage:    node colour-check.mjs --all [--widths 390,1440] [--conc 4] [--limit N] [--config site.config.json]
//           node colour-check.mjs /about /contact
// Inputs:   wordpress.localOrigin, webflow.stagingOrigin
//           <verifyDir>/staging-paths.json            from staging-paths.mjs (with --all)
//           <inventoryDir>/urls.csv (optional)        columns path, expected_path, for pages renamed on purpose
//           pathRewrites (optional)                   [{ prefixRe, to }] as in page-sweep.mjs
//           checks.excludePathRes (optional)          paths left out
//           checks.sweep.prep.wp / .wf (optional)     the same accepted-difference script page-sweep.mjs runs
// Outputs:  <verifyDir>/colour-check.json and <verifyDir>/colour-check.md
//           The count of page loads compared goes to standard error.
// Exit codes: 0 nothing hard to read; 1 text hard to read or invisible on staging that WordPress shows, or a page
//           that could not be loaded; 2 config missing or no path given.
// Network:  the local WordPress copy and the staging origin, read only. Trackers and form posts are blocked. Nothing
//           is clicked or submitted.
// Needs:    playwright (npm install, then npx playwright install chromium).
// Known limits: text over a picture is not measured. Text the old site itself prints unreadable is listed as "no"
//           under "Real?": it is the old site's fault and a decision for the owner, not a build fault. Text is
//           matched by its first 40 characters, so a short label that appears twice is compared with its shortest match.
import fs from 'node:fs';
import { opt, origin, arg, has, positionals, verify, inventory, readJson, readCsv } from './site.mjs';

const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const WIDTHS = String(arg('--widths', '390,1440')).split(',').map(Number).filter(Boolean);
const CONC = +arg('--conc', 4);
const SIDE_PREP = opt('checks.sweep.prep', {});
let pages = positionals(['--widths', '--conc', '--limit']);
if (has('--all')) {
  const EXCLUDE = opt('checks.excludePathRes', []).map((s) => new RegExp(s));
  pages = Object.keys(readJson(verify('staging-paths.json'), 'staging-paths.mjs')).filter((p) => !EXCLUDE.some((r) => r.test(p))).sort();
}
pages = pages.slice(0, +arg('--limit', 1e9));
if (!pages.length) { console.error('colour-check: give at least one path, or --all. For example: node colour-check.mjs --all'); process.exit(2); }

// staging path -> WordPress path, for pages renamed on purpose (as page-sweep.mjs)
const bare = (p) => (p.split('?')[0].replace(/\/+$/, '') || '/');
const wpPathFor = {};
const urlsFile = inventory('urls.csv');
if (fs.existsSync(urlsFile)) for (const r of readCsv(urlsFile)) {
  if (!r.expected_path || !r.path || r.expected_path.includes('?')) continue;
  const k = bare(r.expected_path); if (bare(r.path) === k || !(k in wpPathFor)) wpPathFor[k] = r.path;
}
for (const r of opt('pathRewrites', [])) if (r.prefixRe && r.to && !(bare(r.to) in wpPathFor)) wpPathFor[bare(r.to)] = r.prefixRe.replace(/^\^/, '').replace(/\/\?\$?$/, '').replace(/\$$/, '') + '/';
const wpPath = (p) => wpPathFor[bare(p)] || (p === '/' ? '/' : p.replace(/\/+$/, '') + '/');

const { chromium, devices } = await import('playwright');
const { guard } = await import('./block.mjs');
const browser = await chromium.launch();

// ---- in the page ----
const SCAN = ({ inlineOnly }) => {
  document.documentElement.style.scrollBehavior = 'auto'; document.body.style.scrollBehavior = 'auto';   // a theme that scrolls smoothly leaves most text 'off screen' when it is measured
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (fg, bg, a) => ({ r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) });
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
  const visible = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let x = e; x; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; } return true; };
  const behind = (e) => {   // what the text sits on: first opaque layer in the paint stack at the text's first line
    const range = document.createRange(); const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); if (tn) range.selectNodeContents(tn); const rects = tn ? range.getClientRects() : []; const r0 = rects[0] || e.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, r0.top + scrollY - innerHeight / 2)); const rr = (tn ? range.getClientRects()[0] : null) || e.getBoundingClientRect();
    const x = rr.left + Math.min(rr.width / 2, 20), y = rr.top + rr.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { kind: 'offscreen' };
    const stack = document.elementsFromPoint(x, y); let bg = null;
    for (const el of stack) { const c = getComputedStyle(el);
      if (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|svg)$/i.test(el.tagName) && !el.contains(e) && el !== e) return { kind: 'image' };
      if (c.backgroundImage && c.backgroundImage !== 'none' && !/gradient\(.*transparent/.test(c.backgroundImage)) return { kind: 'image' };
      const p = parse(c.backgroundColor); if (p && p.a > 0) { bg = bg ? blend(bg, p, 1) : p; if (p.a >= 0.99) return { kind: 'colour', bg: p }; } }
    return { kind: 'colour', bg: { r: 255, g: 255, b: 255, a: 1 }, fallback: true };   // nothing opaque: the canvas (white)
  };
  const out = []; const all = inlineOnly ? [...document.querySelectorAll('[style*="color"]')] : [...document.body.querySelectorAll('*')].filter(own);
  for (const e of all) {
    if (e.closest('script,style,noscript,svg,.w-webflow-badge,[aria-hidden="true"]')) continue;
    const text = (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim(); const st = e.getAttribute('style') || '';
    if (!visible(e)) { if (inlineOnly) out.push({ text: text.slice(0, 80), style: st.slice(0, 120), hidden: true }); continue; }
    // measure the element that actually paints the text: the parent of its first non-empty text node (an inline colour on an
    // outer span can be overridden by a class on an inner one)
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim().length > 1 ? 1 : 3) }); const tnode = walker.nextNode(); const host = tnode ? tnode.parentElement : e;
    const c = getComputedStyle(host); const fg = parse(c.color); let op = 1; for (let x = host; x; x = x.parentElement) op *= +getComputedStyle(x).opacity;
    const b = behind(host); let cr = null; if (b.kind === 'colour' && fg) cr = Math.round(ratio(blend(fg, b.bg, fg.a * op), b.bg) * 100) / 100;
    out.push({ tag: host.tagName.toLowerCase() + (host !== e ? ' (in ' + e.tagName.toLowerCase() + ')' : ''), cls: String(e.className).slice(0, 60), text: text.slice(0, 80), style: st.slice(0, 120), color: c.color, opacity: Math.round(op * 100) / 100, behind: b.kind, bg: b.bg ? `rgb(${b.bg.r}, ${b.bg.g}, ${b.bg.b})` : null, fallback: !!b.fallback, ratio: cr, hasText: text.length > 1 });
  }
  return out;
};
// a page with a live map never goes network-idle: the status comes from the load, and a refused load is tried once more
async function load(ctx, url, side) {
  const p = await ctx.newPage(); let status = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const r = await p.goto(url, { waitUntil: 'load', timeout: 90000 }); status = r ? r.status() : 0; } catch { status = 0; }
    if (status === 200 || status === 404 || status === 410) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await p.evaluate(async () => { const st = document.createElement('style'); st.textContent = '.w-webflow-badge{display:none!important}'; document.head.appendChild(st); await document.fonts.ready; await new Promise((r) => setTimeout(r, 1200)); });
  if (SIDE_PREP[side]) await p.evaluate(SIDE_PREP[side]);
  return { p, status };
}
const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
async function one(path, w) {
  const dev = w < 768 ? { ...devices['iPhone 13'], viewport: { width: w, height: 844 } } : { viewport: { width: w, height: 900 }, deviceScaleFactor: 1 };
  const ca = await browser.newContext({ ...dev, reducedMotion: 'reduce' }), cb = await browser.newContext({ ...dev, reducedMotion: 'reduce' }); await guard(ca); await guard(cb);
  const [A, B] = await Promise.all([load(ca, WP + wpPath(path), 'wp'), load(cb, WF + path, 'wf')]); const pa = A.p, pb = B.p;
  if (A.status !== 200 || B.status !== 200) { await ca.close(); await cb.close(); return { path, w, error: `not 200 on both sides (WordPress ${A.status}, staging ${B.status})` }; }
  const wpInline = await pa.evaluate(SCAN, { inlineOnly: true }); const wpAll = await pa.evaluate(SCAN, { inlineOnly: false }); const wfAll = await pb.evaluate(SCAN, { inlineOnly: false });
  await ca.close(); await cb.close();
  const find = (list, t) => { const k = norm(t).slice(0, 40); if (k.length < 3) return null; const c = list.filter((x) => x.ratio !== undefined && norm(x.text).includes(k)); c.sort((a, b) => a.text.length - b.text.length); return c[0] || null; };
  const inline = wpInline.map((x) => { if (x.hidden || !x.hasText) return { ...x, match: null, verdict: x.hidden ? 'hidden on WordPress' : 'no text (background only)' };
    const m = find(wfAll, x.text); if (!m) return { ...x, match: null, verdict: 'text not found on staging' };
    let verdict = 'same colour'; if (m.color !== x.color || m.bg !== x.bg) verdict = 'different, readable';
    if (m.ratio !== null && x.ratio !== null && m.ratio < 3 && x.ratio >= 3) verdict = 'HARD TO READ on staging';
    if (m.behind === 'image' || x.behind === 'image') verdict = verdict === 'same colour' ? verdict : verdict + ' (image behind)';
    return { ...x, match: { color: m.color, bg: m.bg, behind: m.behind, ratio: m.ratio, text: m.text.slice(0, 60), opacity: m.opacity }, verdict }; });
  const invisible = wfAll.filter((x) => x.ratio !== null && x.ratio < 1.5).map((x) => { const m = find(wpAll, x.text); return { ...x, wp: m && { color: m.color, bg: m.bg, ratio: m.ratio, behind: m.behind }, real: !!(m && m.ratio !== null && m.ratio >= 3) }; });
  const counts = { wfText: wfAll.length, wfColour: wfAll.filter((x) => x.ratio !== null).length, wfImage: wfAll.filter((x) => x.behind === 'image').length, wfOff: wfAll.filter((x) => x.behind === 'offscreen').length };
  console.log(`${path} @${w}: inline ${wpInline.length} (${inline.filter((x) => /HARD/.test(x.verdict)).length} hard, ${inline.filter((x) => /different/.test(x.verdict)).length} different); staging text ${counts.wfText}, under 1.5:1 ${invisible.length} (${invisible.filter((x) => x.real).length} readable on WordPress)`);
  return { path, w, inline, invisible, counts };
}
const jobs = pages.flatMap((p) => WIDTHS.map((w) => [p, w])); const res = [];
await Promise.all([...Array(CONC)].map(async () => { while (jobs.length) { const [p, w] = jobs.shift(); try { let t; res.push(await Promise.race([one(p, w), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('no result after 300 s: the page hung')), 300000); })]).finally(() => clearTimeout(t))); } catch (e) { console.log('ERR', p, w, e.message.split('\n')[0]); res.push({ path: p, w, error: e.message.split('\n')[0] }); } } }));
await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000))]);   // a hung page can hold the browser open
fs.writeFileSync(verify('colour-check.json'), JSON.stringify(res, null, 1));
const ok = res.filter((r) => !r.error); const inl = ok.flatMap((r) => r.inline.map((x) => ({ ...x, path: r.path, w: r.w }))); const inv = ok.flatMap((r) => r.invisible.map((x) => ({ ...x, path: r.path, w: r.w })));
const by = (k) => inl.filter((x) => x.verdict.startsWith(k)).length;
const md = ['# Text colour check: WordPress vs staging', '', `${new Date().toISOString().slice(0, 16)}Z · ${ok.length} of ${res.length} page loads compared (${pages.length} pages × ${WIDTHS.join('/')})${res.length - ok.length ? ' · not compared: ' + res.filter((r) => r.error).map((r) => r.path + ' @' + r.w).join(', ') : ''}`, '',
  '## 1. Inline colours on WordPress', '', `${inl.length} inline-coloured elements (element × width): same colour ${by('same')}, different but readable ${by('different')}, **hard to read on staging ${by('HARD')}**, text not found on staging ${by('text not found')}, background only ${by('no text')}, hidden on WordPress ${by('hidden')}.`, '',
  '| Page | Width | Text | WordPress colour / behind / ratio | Staging colour / behind / ratio | Verdict |', '|---|---:|---|---|---|---|',
  ...inl.filter((x) => !/^(same|hidden|no text)/.test(x.verdict)).map((x) => `| ${x.path} | ${x.w} | ${x.text.slice(0, 40).replace(/\|/g, '/')} | ${x.color} / ${x.bg || x.behind} / ${x.ratio ?? '–'} | ${x.match ? `${x.match.color} / ${x.match.bg || x.match.behind} / ${x.match.ratio ?? '–'}` : '–'} | ${x.verdict} |`), '',
  '## 2. Text under 1.5:1 on staging', '', `${ok.reduce((s, r) => s + r.counts.wfText, 0)} visible text elements on staging (element × width), ${ok.reduce((s, r) => s + r.counts.wfColour, 0)} on a measured colour, ${ok.reduce((s, r) => s + r.counts.wfImage, 0)} on an image (not measured), ${ok.reduce((s, r) => s + r.counts.wfOff, 0)} off screen. Under 1.5:1: ${inv.length}; of those readable (>= 3:1) on WordPress: **${inv.filter((x) => x.real).length}**.`, '',
  '| Page | Width | Text | Staging colour / behind / ratio | WordPress ratio | Real? |', '|---|---:|---|---|---|---|',
  ...inv.map((x) => `| ${x.path} | ${x.w} | ${x.text.slice(0, 40).replace(/\|/g, '/')} | ${x.color} / ${x.bg} / ${x.ratio} | ${x.wp ? x.wp.ratio ?? x.wp.behind : 'not found'} | ${x.real ? '**yes**' : 'no'} |`)];
fs.writeFileSync(verify('colour-check.md'), md.join('\n') + '\n');
const hard = by('HARD'), real = inv.filter((x) => x.real).length, failed = res.length - ok.length;
console.error(`colour-check: ${ok.length} of ${res.length} page loads compared; inline colours ${inl.length}, hard to read ${hard}; text under 1.5:1 on staging ${inv.length}, readable on WordPress ${real} → ${verify('colour-check.md')}`);
process.exit(hard || real || failed ? 1 : 0);
