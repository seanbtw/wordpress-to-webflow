// page-sweep.mjs — the whole-page sweep: EVERY page, WordPress (local copy) against staging, part by part, with the
// measured cause of each difference. It exists because sampled measurements pass while real pages differ: a block
// spec proves the blocks it names, and one template example proves that one item. This run has no sample.
//
// How it works. Each page is split into its parts: the direct children of the main content wrapper, then the footer,
// paired in order. For each pair it compares the box (a part missing, extra, or a different height), then lays the two
// parts over each other ONLY TO LOCATE where they differ (16 px cells joined into regions), then reads the computed
// values of the element under each region on both sides (tag, font, size, weight, line height, colour, padding, margin,
// border, gap, display and so on). So every difference is reported as a measured value, WordPress → staging. The
// pictures it saves are for finding the place, never the verdict.
//
// Usage:    node page-sweep.mjs --all [--widths 390,768,1440] [--conc 4] [--limit N] [--bust]
//           node page-sweep.mjs /about /blog/a-post            only these paths
//           node page-sweep.mjs --triage [--min 0.5]            regroup the saved results by cause, no page loads
// Inputs:   wordpress.localOrigin, webflow.stagingOrigin
//           <verifyDir>/staging-paths.json (with --all)   from staging-paths.mjs
//           <inventoryDir>/urls.csv (optional)            columns path, expected_path: the WordPress path of a
//                                                         staging path that was renamed on purpose
//           checks.excludePathRes (optional, with --all)  paths left out (lab and style-guide pages, for example)
//           checks.sweep.widths (optional)                default [390, 768, 1440]
//           checks.sweep.parts (optional)                 selector of the wrapper whose direct children are the
//                                                         parts, default "main > article, main" (first match)
//           checks.sweep.footer (optional)                default "footer"
//           checks.sweep.hide (optional)                  selector of bars that float over the page; any match
//                                                         that is fixed or sticky is hidden while values are read.
//                                                         Default "header, nav, [role=banner]"
//           checks.sweep.minPct (optional)                share of a part's pixels that must differ before the
//                                                         part is listed, default 0.5
// Outputs:  <verifyDir>/sweep/<page>.<width>.json   every part of that page at that width, with regions and values
//           <verifyDir>/sweep/img/…png              WordPress | staging | difference, for parts that differ
//           <verifyDir>/sweep/summary.md            parts that differ, worst first
//           <verifyDir>/sweep/triage.md             the same differences grouped by cause (staging element +
//                                                   property), by number of pages: one fix per row
//           The count of page loads compared goes to standard error, so a run that compared nothing is plain to see.
// Exit codes: 0 no part differs; 1 a part differs or a page could not be loaded; 2 config missing or no path given.
// Network:  the local WordPress copy and the staging origin, read only. Trackers and form posts are blocked. Nothing
//           is clicked or submitted. --bust adds a ?sweep= parameter to staging requests to get past a cache; leave
//           it off on pages whose scripts read the query string (filters), where it changes what is shown.
// Needs:    playwright, pixelmatch, pngjs (npm install, then npx playwright install chromium).
// Reading the result: start with triage.md. Fix causes from the top; one row usually covers many pages. Then
//           summary.md for parts missing, extra or a different height. Run again until it is clean or every row
//           left has a line in accepted-differences.md. Expect the first run to be loud.
import fs from 'node:fs';
import path from 'node:path';
import { opt, origin, arg, has, positionals, verify, inventory, readJson, readCsv } from './site.mjs';

const OUT = path.dirname(verify('sweep', 'img', 'x'));          // …/sweep/img, created
const DIR = path.dirname(OUT);                                  // …/sweep
const MIN = +arg('--min', opt('checks.sweep.minPct', 0.5));
const slug = (p) => (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[/?=&]+/g, '--'));
const differs = (p) => p.issue || Math.abs(p.dh || 0) > 2 || (p.diffPct || 0) > MIN;

// ---------------------------------------------------------------------------------------------- triage
function triage() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  const causes = new Map(); const shape = []; let parts = 0, bad = 0;
  const name = (side) => (side ? `${side.tag}.${(side.cls || '').split(' ').filter((c) => c && !/^w-/.test(c)).slice(0, 2).join('.')}` : '?');
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); if (!r.parts) continue;
    for (const p of r.parts) {
      parts++; if (!differs(p)) continue; bad++;
      if (p.issue || Math.abs(p.dh || 0) > 2) shape.push({ page: r.path, w: r.w, i: p.i, sig: p.wp?.sig || p.wf?.sig, issue: p.issue, wpH: p.wp?.h, wfH: p.wf?.h, dh: p.dh, img: p.img });
      for (const g of p.regions || []) for (const lvl of ['el', 'parent']) {
        const d = g.diff[lvl]; if (!d) continue;
        for (const [prop, v] of Object.entries(d)) {
          if (/^box\.|^text$|^missing$/.test(prop)) continue;   // positions and text follow from other causes
          const k = `${name(g.wf?.[lvl])} | ${lvl === 'parent' ? 'parent ' : ''}${prop} | ${String(v[0]).slice(0, 60)} → ${String(v[1]).slice(0, 60)}`;
          const c = causes.get(k) || { k, n: 0, pages: new Set(), widths: new Set(), wpEl: name(g.wp?.[lvl]), sample: null };
          c.n++; c.pages.add(r.path); c.widths.add(r.w); c.sample = c.sample || { page: r.path, w: r.w, text: g.wp?.[lvl]?.text, img: p.img };
          causes.set(k, c);
        }
      }
    }
  }
  const list = [...causes.values()].sort((a, b) => b.pages.size - a.pages.size || b.n - a.n);
  const cell = (s) => String(s ?? '').replace(/\|/g, '/');
  const md = ['# Sweep triage', '', `${files.length} page × width results · ${parts} parts · ${bad} differ (pixels > ${MIN} %, or height by more than 2 px, or missing)`, '',
    '## Causes, by number of pages', '', 'Staging element (WordPress element) and the property that differs, WordPress → staging. One fix per row.', '',
    '| Pages | Hits | Widths | Staging element (WordPress element) | Property: WordPress → staging | Example |', '|---:|---:|---|---|---|---|',
    ...list.slice(0, 300).map((c) => { const [el, prop, val] = c.k.split(' | '); return `| ${c.pages.size} | ${c.n} | ${[...c.widths].sort((a, b) => a - b).join('/')} | ${cell(el)} (${cell(c.wpEl)}) | ${cell(prop)}: ${cell(val)} | ${c.sample.page} @${c.sample.w} "${cell((c.sample.text || '').slice(0, 24))}" ${c.sample.img || ''} |`; }),
    '', '## Parts missing, extra or a different height', '', '| Page | Width | Part | Issue | WordPress h | Staging h | Δh | Picture |', '|---|---:|---|---|---:|---:|---:|---|',
    ...shape.sort((a, b) => (b.issue ? 1e6 : Math.abs(b.dh)) - (a.issue ? 1e6 : Math.abs(a.dh))).map((s) => `| ${s.page} | ${s.w} | #${s.i} ${cell(s.sig)} | ${s.issue || ''} | ${s.wpH ?? '–'} | ${s.wfH ?? '–'} | ${s.dh ?? ''} | ${s.img || ''} |`)];
  fs.writeFileSync(path.join(DIR, 'triage.md'), md.join('\n') + '\n');
  console.error(`page-sweep: triage of ${files.length} results, ${bad} of ${parts} parts differ, ${list.length} causes → ${path.join(DIR, 'triage.md')}`);
  return bad;
}
if (has('--triage')) process.exit(triage() ? 1 : 0);

// ---------------------------------------------------------------------------------------------- the run
const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const WIDTHS = String(arg('--widths', opt('checks.sweep.widths', [390, 768, 1440]).join(','))).split(',').map(Number).filter(Boolean);
const CONC = +arg('--conc', 4);
const SEL = { parts: opt('checks.sweep.parts', 'main > article, main'), footer: opt('checks.sweep.footer', 'footer'), hide: opt('checks.sweep.hide', 'header, nav, [role=banner]') };

let pages = positionals(['--widths', '--conc', '--limit', '--min']);
if (has('--all')) {
  const EXCLUDE = opt('checks.excludePathRes', []).map((s) => new RegExp(s));
  pages = Object.keys(readJson(verify('staging-paths.json'), 'staging-paths.mjs')).filter((p) => !EXCLUDE.some((r) => r.test(p))).sort();
}
pages = pages.slice(0, +arg('--limit', 1e9));
if (!pages.length) { console.error('page-sweep: give at least one path, or --all. For example: node page-sweep.mjs --all'); process.exit(2); }

// staging path -> WordPress path, for pages renamed on purpose
const bare = (p) => (p.split('?')[0].replace(/\/+$/, '') || '/');
const wpPathFor = {};
const urlsFile = inventory('urls.csv');
if (fs.existsSync(urlsFile)) for (const r of readCsv(urlsFile)) if (r.expected_path && r.path) wpPathFor[bare(r.expected_path)] ??= r.path;
const wpPath = (p) => wpPathFor[bare(p)] || (p === '/' ? '/' : p.replace(/\/+$/, '') + '/');

const { chromium, devices } = await import('playwright');
const { PNG } = await import('pngjs');
const pixelmatch = (await import('pixelmatch')).default;
const { guard } = await import('./block.mjs');
const browser = await chromium.launch();

// ---- in the page ----
const PREP = async () => {   // everything loaded and still, so the two sides are compared in the same state
  document.documentElement.style.scrollBehavior = 'auto';
  document.querySelectorAll('img[loading=lazy]').forEach((i) => i.setAttribute('loading', 'eager'));
  document.querySelectorAll('img[data-src], img[data-srcset], source[data-srcset]').forEach((i) => { if (i.dataset.srcset) i.srcset = i.dataset.srcset; if (i.dataset.src) i.src = i.dataset.src; });
  document.querySelectorAll('[data-bg]').forEach((e) => { e.style.backgroundImage = `url("${e.dataset.bg}")`; });
  for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }   // wake scroll-triggered loaders
  window.scrollTo(0, 0); await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  await new Promise((r) => setTimeout(r, 1500));
  await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 5000); }))));
  const st = document.createElement('style'); st.textContent = '.w-webflow-badge{display:none!important} *{caret-color:transparent!important}'; document.head.appendChild(st);
};
const PARTS = (SEL) => {
  let wrap = null; for (const s of SEL.parts.split(',')) { wrap = document.querySelector(s.trim()); if (wrap) break; }
  const kids = wrap ? [...wrap.children] : [];
  const foot = document.querySelector(SEL.footer);
  const all = [...kids, ...(foot && !wrap?.contains(foot) ? [foot] : [])].filter((e) => !/^(script|style|template|noscript)$/i.test(e.tagName));
  const sig = (e) => e.id ? `${e.tagName.toLowerCase()}#${e.id}` : `${e.tagName.toLowerCase()}.${String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(/\s+/).filter(Boolean)[0] || ''}`;
  return all.map((e, i) => { const r = e.getBoundingClientRect(); return { i, sig: sig(e), cls: String(e.className).slice(0, 80), x: Math.max(0, Math.round(r.left + scrollX)), y: Math.max(0, Math.round(r.top + scrollY)), w: Math.round(r.width), h: Math.round(r.height), text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60) }; })
    .filter((p) => p.w > 0 && p.h > 0);
};
const PROBE = async ({ pts, hideSel }) => {   // measured values of the element under each point (document coordinates)
  const hide = [...document.querySelectorAll(hideSel)].filter((e) => /fixed|sticky/.test(getComputedStyle(e).position));
  const one = (el) => { const c = getComputedStyle(el), r = el.getBoundingClientRect(); const bw = [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth];
    return { tag: el.tagName.toLowerCase(), cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 90), text: (el.innerText || el.getAttribute?.('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      box: [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
      font: c.fontFamily.split(',')[0].replace(/"/g, ''), size: c.fontSize, weight: c.fontWeight, lh: c.lineHeight, ls: c.letterSpacing, tt: c.textTransform, color: c.color, bg: c.backgroundColor, bgimg: c.backgroundImage.slice(0, 80),
      pad: c.padding, margin: c.margin, border: bw.every((w) => parseFloat(w) === 0) ? 'none' : [...bw, c.borderTopStyle, c.borderTopColor].join(' '),   // a border with no width is no border, whatever its style
      radius: c.borderRadius, op: c.opacity, gap: c.gap, display: c.display, ta: c.textAlign, deco: c.textDecorationLine, shadow: c.boxShadow, obj: c.objectFit }; };
  const out = [];
  for (const [x, y] of pts) {
    window.scrollTo(0, Math.max(0, y - 300)); await new Promise((r) => setTimeout(r, 30));
    hide.forEach((e) => (e.style.visibility = 'hidden')); const e = document.elementFromPoint(x - scrollX, y - scrollY); hide.forEach((h) => (h.style.visibility = ''));
    out.push(e ? { el: one(e), parent: e.parentElement ? one(e.parentElement) : null } : null);
  }
  return out;
};

async function grab(ctx, url) {
  const p = await ctx.newPage(); const errors = []; let status = 0;
  p.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  try { const r = await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }); status = r ? r.status() : 0; } catch { /* measure what loaded */ }
  await p.evaluate(PREP); const parts = await p.evaluate(PARTS, SEL);
  const shot = PNG.sync.read(await p.screenshot({ fullPage: true, animations: 'disabled' }));
  return { p, parts, shot, errors, status, docH: await p.evaluate(() => document.documentElement.scrollHeight) };
}
const crop = (png, x, y, w, h) => { const o = new PNG({ width: w, height: h }); for (let r = 0; r < h; r++) { const sy = y + r; if (sy >= png.height) break; png.data.copy(o.data, r * w * 4, (sy * png.width + x) * 4, (sy * png.width + x + Math.min(w, png.width - x)) * 4); } return o; };
function regions(diff, w, h, cell = 16) {   // cells with more than 4 % differing pixels, joined (8 neighbours) into boxes
  const cw = Math.ceil(w / cell), ch = Math.ceil(h / cell); const hot = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) { let n = 0, t = 0; for (let y = cy * cell; y < Math.min(h, cy * cell + cell); y++) for (let x = cx * cell; x < Math.min(w, cx * cell + cell); x++) { t++; const i = (y * w + x) * 4; if (diff.data[i] === 255 && diff.data[i + 1] === 0) n++; } if (n / t > 0.04) hot[cy * cw + cx] = 1; }
  const seen = new Uint8Array(cw * ch); const out = [];
  for (let s = 0; s < hot.length; s++) { if (!hot[s] || seen[s]) continue; let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0; const st = [s]; seen[s] = 1;
    while (st.length) { const k = st.pop(); const cx = k % cw, cy = (k / cw) | 0; n++; x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue; const q = ny * cw + nx; if (hot[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
    out.push({ x: x0 * cell, y: y0 * cell, w: (x1 - x0 + 1) * cell, h: (y1 - y0 + 1) * cell, cells: n }); }
  return out.sort((a, b) => b.cells - a.cells);
}
const KEYS = ['tag', 'font', 'size', 'weight', 'lh', 'ls', 'tt', 'color', 'bg', 'bgimg', 'pad', 'margin', 'border', 'radius', 'op', 'gap', 'display', 'ta', 'deco', 'shadow', 'obj'];
const delta = (a, b) => { if (!a || !b) return { missing: [!!a, !!b] }; const o = {}; for (const k of KEYS) if (String(a[k]) !== String(b[k])) o[k] = [a[k], b[k]];
  for (const [i, k] of ['x', 'y', 'w', 'h'].entries()) if (Math.abs(a.box[i] - b.box[i]) > 2) o['box.' + k] = [a.box[i], b.box[i]]; if (a.text !== b.text) o.text = [a.text, b.text]; return o; };

async function one(pagePath, w) {
  const dev = w < 768 ? { ...devices['iPhone 13'], viewport: { width: w, height: 844 } } : { viewport: { width: w, height: 900 } };
  const mk = async () => { const c = await browser.newContext({ ...dev, deviceScaleFactor: 1, reducedMotion: 'reduce' }); await guard(c); return c; };
  const ca = await mk(), cb = await mk();
  const wfUrl = WF + pagePath + (has('--bust') ? (pagePath.includes('?') ? '&' : '?') + 'sweep=' + Date.now() : '');
  const [A, B] = await Promise.all([grab(ca, WP + wpPath(pagePath)), grab(cb, wfUrl)]);
  const res = { path: pagePath, w, wpPath: wpPath(pagePath), status: [A.status, B.status], docH: [A.docH, B.docH], partCount: [A.parts.length, B.parts.length], errors: { wp: A.errors, wf: B.errors }, parts: [] };
  if (A.status !== 200 || B.status !== 200) res.error = `not 200 on both sides (WordPress ${A.status}, staging ${B.status})`;
  const n = res.error ? 0 : Math.max(A.parts.length, B.parts.length);
  for (let i = 0; i < n; i++) {
    const a = A.parts[i], b = B.parts[i]; const row = { i, wp: a && { sig: a.sig, cls: a.cls, y: a.y, w: a.w, h: a.h, text: a.text }, wf: b && { sig: b.sig, cls: b.cls, y: b.y, w: b.w, h: b.h, text: b.text } };
    if (!a || !b) { row.issue = a ? 'missing on staging' : 'extra on staging'; res.parts.push(row); continue; }
    row.dh = b.h - a.h; row.dw = b.w - a.w;
    const cw = Math.min(a.w, b.w, A.shot.width - a.x, B.shot.width - b.x), chh = Math.min(a.h, b.h, A.shot.height - a.y, B.shot.height - b.y);
    if (cw <= 0 || chh <= 0) { res.parts.push(row); continue; }
    const ia = crop(A.shot, a.x, a.y, cw, chh), ib = crop(B.shot, b.x, b.y, cw, chh); const diff = new PNG({ width: cw, height: chh });
    const px = pixelmatch(ia.data, ib.data, diff.data, cw, chh, { threshold: 0.12, includeAA: false, diffColor: [255, 0, 0], alpha: 0.25 });
    row.diffPct = Math.round((px / (cw * chh)) * 10000) / 100;
    const regs = regions(diff, cw, chh).slice(0, 8);
    if (regs.length) {
      const pts = regs.map((r) => [r.x + Math.min(r.w / 2, 40), r.y + Math.min(r.h / 2, 24)]);   // a point near each region's top-left, where a shift starts
      const [pa, pb] = await Promise.all([A.p.evaluate(PROBE, { pts: pts.map(([x, y]) => [a.x + x, a.y + y]), hideSel: SEL.hide }), B.p.evaluate(PROBE, { pts: pts.map(([x, y]) => [b.x + x, b.y + y]), hideSel: SEL.hide })]);
      row.regions = regs.map((r, k) => ({ ...r, at: [a.x + r.x, a.y + r.y], wp: pa[k], wf: pb[k], diff: { el: delta(pa[k]?.el, pb[k]?.el), parent: delta(pa[k]?.parent, pb[k]?.parent) } }));
      if (differs(row)) {   // a picture to find the place: WordPress | staging | difference (capped at 2400 px tall)
        const H = Math.min(chh, 2400), out = new PNG({ width: cw * 3 + 20, height: H }); out.data.fill(255);
        for (const [k, img] of [[0, ia], [1, ib], [2, diff]]) for (let y = 0; y < H; y++) img.data.copy(out.data, (y * out.width + k * (cw + 10)) * 4, y * cw * 4, (y * cw + cw) * 4);
        row.img = `img/${slug(pagePath)}.${w}.${i}.png`; fs.writeFileSync(path.join(DIR, row.img), PNG.sync.write(out)); }
    }
    res.parts.push(row);
  }
  await A.p.close(); await B.p.close(); await ca.close(); await cb.close();
  fs.writeFileSync(path.join(DIR, `${slug(pagePath)}.${w}.json`), JSON.stringify(res, null, 1));
  const bad = res.parts.filter(differs);
  console.error(`${pagePath} @${w}: ${res.error ? res.error : `parts ${res.partCount.join('/')}, ${bad.length} differ` + (bad.length ? ' — ' + bad.slice(0, 3).map((r) => `#${r.i} ${r.wp?.sig || r.wf?.sig}${r.issue ? ' ' + r.issue : ''}${r.dh ? ' Δh ' + r.dh : ''} ${r.diffPct ?? ''}%`).join(', ') : '')}`);
  return res;
}

const jobs = pages.flatMap((p) => WIDTHS.map((w) => [p, w])); const total = jobs.length; const all = [];
await Promise.all([...Array(CONC)].map(async () => { while (jobs.length) { const [p, w] = jobs.shift(); try { all.push(await one(p, w)); } catch (e) { console.error('ERR', p, w, e.message.split('\n')[0]); all.push({ path: p, w, error: e.message.split('\n')[0] }); } } }));
await browser.close();

// summary: parts that differ, worst first; pages that could not be compared, first of all
const failed = all.filter((r) => r.error);
const rows = all.flatMap((r) => (r.parts || []).filter(differs).map((x) => ({ path: r.path, w: r.w, ...x })));
rows.sort((a, b) => (b.issue ? 1e9 : Math.abs(b.dh || 0) * 100 + (b.diffPct || 0)) - (a.issue ? 1e9 : Math.abs(a.dh || 0) * 100 + (a.diffPct || 0)));
const cell = (s) => String(s ?? '').replace(/\|/g, '/');
const md = ['# Whole-page sweep: WordPress (local copy) against staging', '',
  `${new Date().toISOString().slice(0, 16)}Z · ${total - failed.length} of ${total} page loads compared (${pages.length} pages × ${WIDTHS.join('/')}) · parts that differ: ${rows.length}`, '',
  ...(failed.length ? ['## Not compared', '', ...failed.map((r) => `- ${r.path} @${r.w}: ${r.error}`), ''] : []),
  '| Page | Width | Part | WordPress h | Staging h | Δh | Pixels differ | First difference (element: property WordPress → staging) | Picture |', '|---|---:|---|---:|---:|---:|---:|---|---|',
  ...rows.map((x) => { const r0 = x.regions?.[0]; const d = r0 ? Object.entries(r0.diff.el).slice(0, 4).map(([k, v]) => `${k}: ${String(v[0]).slice(0, 30)} → ${String(v[1]).slice(0, 30)}`).join('; ') : ''; return `| ${x.path} | ${x.w} | #${x.i} ${cell(x.wp?.sig || x.wf?.sig)} ${x.issue || ''} | ${x.wp?.h ?? '–'} | ${x.wf?.h ?? '–'} | ${x.dh ?? ''} | ${x.diffPct ?? ''}% | ${r0 ? `${r0.wp?.el?.tag || '?'}.${cell((r0.wp?.el?.cls || '').split(' ')[0])} "${cell((r0.wp?.el?.text || '').slice(0, 20))}" — ${cell(d)}` : ''} | ${x.img || ''} |`; })];
fs.writeFileSync(path.join(DIR, 'summary.md'), md.join('\n') + '\n');
console.error(`page-sweep: ${total - failed.length} of ${total} page loads compared; ${rows.length} parts differ → ${path.join(DIR, 'summary.md')}`);
triage();
process.exit(rows.length || failed.length ? 1 : 0);
