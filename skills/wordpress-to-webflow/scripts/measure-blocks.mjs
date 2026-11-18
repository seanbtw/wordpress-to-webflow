// measure-blocks.mjs — compares a block on the local WordPress copy with the same block on Webflow staging by
// measured values, not by picture. It walks both blocks in document order, pairs their "content" elements by what
// they are, in order (elements with their own text, media, form fields, or a background, background image or border), and
// compares each pair: box relative to the block (x, y, width, height), font family, size, weight, line height,
// letter spacing, text transform, colour, background colour and image, border widths, radius and drawn opacity.
//
// Usage:    node measure-blocks.mjs <spec.json> [--dump] [--config site.config.json]
//           spec.json: [{ "name": "hero",
//                         "wp": { "path": "/about/", "sel": "section.hero", "index": 0, "hide": [".cookie-bar"] },
//                         "wf": { "path": "/about",  "sel": "[data-block=hero]" },
//                         "widths": [390, 768, 1200, 1440, 1920], "tol": 2 }]
//           widths and tol are optional (defaults: checks.measure.widths, 2 px). "hide" hides elements before
//           measuring (a banner, a chat button). Measure a whole template by giving its content wrapper as "sel".
// Inputs:   wordpress.localOrigin, webflow.stagingOrigin
//           checks.measure.widths (optional)          default [390, 768, 1200, 1440, 1920]; add both sides of each
//                                                     of the theme's breakpoints
//           checks.measure.phoneBelow (optional)      widths under this use a phone profile and user agent
//                                                     (default 768): themes can pick markup by user agent
//           checks.measure.oneItemSelector (optional) elements measured as ONE item on both sides (their box, label
//                                                     and colours), for example theme buttons and the Webflow
//                                                     component that replaces them. Pill-shaped links and buttons
//                                                     are always treated this way.
//           checks.measure.skipWithin (optional)      elements inside these are ignored (default ".sr-only")
// Outputs:  <verifyDir>/measure/<name>.json   every mismatch per width
//           <verifyDir>/measure/<name>.<width>.dump.json   both sides' raw items, with --dump
//           one summary line per block on standard output
// Exit codes: 0 every block equal within tolerance; 1 a mismatch or a block not found; 2 config or spec missing.
// Network:  the local WordPress origin and the staging origin. Trackers and form posts are blocked (block.mjs).
// Needs:    playwright (npm install, then npx playwright install chromium).
//
// Why it is built this way (each line was a wrong "pass" or a false alarm once):
//  - Elements with only a background, background image or border are measured too: a text-only walk passed an icon
//    button that had the wrong background.
//  - Zero-size wrappers (<picture>, an inline link) are walked through: their children are visible.
//  - Scrolling is instant: themes set scroll-behavior: smooth, and a smooth scroll is still moving when boxes are read.
//  - Only the staging URL gets a cache-busting query, and --no-bust leaves it off: use that for a page whose own
//    scripts read the query string (a listing that counts every parameter as a filter).
//    Only staging, because on the WordPress side a stray query parameter can change the
//    page (a listing that reads every parameter as a filter).
//  - Reduced motion is on, so sliders rest on their first slide.
//  - The block is scrolled to the top of the window by its measured place, and checked: scrollIntoView left it 80 px off on
//    one side (a page with a sticky bar above the block; a theme's scroll-padding does the same), and whatever was pinned
//    inside the block read 80 px out.
//  - Opacity is the drawn one (the item's own times its wrappers' inside the block): 0.7 on the text on one side and on a
//    wrapper on the other is the same grey, and was 104 false rows.
import fs from 'node:fs';
import { chromium, devices } from 'playwright';
import { opt, origin, verify, positionals, has, stop } from './site.mjs';
import { guard } from './block.mjs';

const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const specFile = positionals()[0];
if (!specFile || !fs.existsSync(specFile)) stop('give a spec file: node measure-blocks.mjs <spec.json>');
const specs = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const WIDTHS = opt('checks.measure.widths', [390, 768, 1200, 1440, 1920]);
const PHONE_BELOW = opt('checks.measure.phoneBelow', 768);
const ONE_ITEM = opt('checks.measure.oneItemSelector', '');
const SKIP_WITHIN = opt('checks.measure.skipWithin', '.sr-only');
const DUMP = has('--dump');

async function measure(ctx, base, { path, sel, index = 0, hide = [] }, bust) {
  const page = await ctx.newPage();
  const url = base + path + (bust ? (path.includes('?') ? '&' : '?') + 'v=' + Date.now() : '');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  const result = await page.evaluate(async ({ sel, index, hide, ONE_ITEM, SKIP_WITHIN }) => {
    document.querySelectorAll('img[loading=lazy]').forEach((i) => i.setAttribute('loading', 'eager'));
    await document.fonts.ready;
    // 5 s at most for each: decode() never settles on a lazy image that never loads (one inside a hidden pane)
    await Promise.all([...document.images].map((i) => Promise.race([i.decode().catch(() => {}), new Promise((r) => setTimeout(r, 5000))])));
    for (const h of hide) document.querySelectorAll(h).forEach((e) => (e.style.display = 'none'));
    const root = document.querySelectorAll(sel)[index];
    if (!root) return null;
    document.documentElement.style.scrollBehavior = 'auto';
    // the block's top goes to the top of the window, by its measured place, and is checked: scrollIntoView can land off it
    // (scroll-padding, scroll-margin, a sticky bar above), and anything fixed or sticky inside is then measured away from its partner
    for (let i = 0; i < 4; i++) {
      const top = root.getBoundingClientRect().top;
      if (Math.abs(top) < 0.5) break;
      window.scrollTo(0, window.scrollY + top);
      await new Promise((done) => setTimeout(done, 300));
    }
    const R = root.getBoundingClientRect();
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (e) => { const b = e.getBoundingClientRect(); return { x: r1(b.left - R.left), y: r1(b.top - R.top), w: r1(b.width), h: r1(b.height) }; };
    const shown = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; };
    const hasBox = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const skipped = (e) => SKIP_WITHIN && e.closest(SKIP_WITHIN);
    // the opacity the item is drawn at: its own times every box around it, up to the block. One side can put 0.7 on the text
    // and the other on a wrapper around it, and the reader sees the same grey.
    const drawnOp = (e) => { let o = 1; for (let n = e; n; n = n.parentElement) { o *= parseFloat(getComputedStyle(n).opacity); if (n === root) break; } return String(Math.round(o * 1000) / 1000); };
    const borders = (s) => ['Top', 'Right', 'Bottom', 'Left'].map((d) => (s[`border${d}Style`] === 'none' ? 0 : parseFloat(s[`border${d}Width`]))).join(' ');
    const bgName = (s) => (s.backgroundImage.match(/([^/"']+)["']?\)\s*$/) || [])[1] || '';
    const family = (s) => s.fontFamily.split(',')[0].replace(/"/g, '');
    // the text a reader sees: not a label hidden with display:none (a "Close" that shows only when the menu is open), not screen-reader text
    const drawn = (x, top) => { for (let n = x; n; n = n.parentElement) { const st = getComputedStyle(n); if (st.display === 'none' || st.visibility === 'hidden') return false; if (n === top) break; } return true; };
    const seen = (e) => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n, t = ''; while ((n = w.nextNode())) { const p = n.parentElement; if (p.closest('svg') || skipped(p) || !drawn(p, e)) continue; t += n.textContent; } return t.replace(/\s+/g, ' ').trim(); };
    const isOne = (e) => {
      if (ONE_ITEM && e.matches(ONE_ITEM)) return true;
      if (!e.matches('a, button')) return false;
      const s = getComputedStyle(e);
      return /flex|inline-block/.test(s.display) && parseFloat(s.borderTopLeftRadius) >= 999;   // a pill link is a button
    };
    const items = [];
    const walk = (parent) => {
      for (const c of parent.children) {
        if (skipped(c)) continue;
        if (c.closest('svg') && c.tagName !== 'svg') continue;
        if (!shown(c)) continue;
        if (!hasBox(c)) { if (c.tagName !== 'svg') walk(c); continue; }   // zero-size wrapper: its children may be visible
        if (isOne(c)) {
          const leaves = [...c.querySelectorAll('*')].filter((x) => !skipped(x) && !x.closest('svg') && x.children.length === 0 && x.textContent.trim() && drawn(x, c));
          const label = leaves.pop() || c; const s = getComputedStyle(c), l = getComputedStyle(label);
          items.push({ tag: 'button', text: seen(label).slice(0, 40), ...box(c), font: family(l), size: l.fontSize, weight: l.fontWeight,
            lh: l.lineHeight, ls: s.letterSpacing, tt: s.textTransform, color: l.color, bg: s.backgroundColor, bgimg: bgName(s), bw: borders(s), radius: s.borderTopLeftRadius, op: drawnOp(c) });
          continue;
        }
        const s = getComputedStyle(c);
        const media = /^(IMG|VIDEO|IFRAME|svg|INPUT|TEXTAREA|SELECT)$/.test(c.tagName);
        const decorated = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.backgroundImage !== 'none' ||
          ['Top', 'Right', 'Bottom', 'Left'].some((d) => parseFloat(s[`border${d}Width`]) > 0 && s[`border${d}Style`] !== 'none');
        if (ownText(c) || media || decorated) {
          let text = c.innerText || '';
          if (SKIP_WITHIN) c.querySelectorAll(SKIP_WITHIN).forEach((x) => { const v = (x.innerText || '').trim(); if (v) text = text.replace(v, ''); });
          items.push({ tag: c.tagName.toLowerCase(), text: (text || c.getAttribute('alt') || '').trim().slice(0, 40), ...box(c), font: family(s), size: s.fontSize,
            weight: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing, tt: s.textTransform, color: s.color, bg: s.backgroundColor, bgimg: bgName(s), bw: borders(s),
            radius: s.borderTopLeftRadius, op: drawnOp(c) });
        }
        if (c.tagName !== 'svg') walk(c);
      }
    };
    walk(root);
    const s = getComputedStyle(root);
    return { root: { ...box(root), bg: s.backgroundColor, color: s.color }, items };
  }, { sel, index, hide, ONE_ITEM, SKIP_WITHIN });
  await page.close();
  return result;
}

// Pairs the two lists by what each item is (its text, or its kind when it has none), keeping the order: the longest run of items the two
// sides share. One wrapper more on one side is then one row, "only on staging", and every item after it still meets its own partner.
// Paired by position, that one wrapper made every later item meet its neighbour: 674 mismatches on a footer that had none.
const kind = (t) => (/^(img|video|iframe|svg|input|textarea|select|button)$/.test(t) ? t : 'box');
const keyOf = (it) => { const t = it.text.replace(/\s+/g, ' ').trim(); return t ? 't:' + t : 'k:' + kind(it.tag); };
const box4 = (it) => `${it.x},${it.y} ${it.w}x${it.h}`;
function align(A, B) {
  const ka = A.map(keyOf), kb = B.map(keyOf), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [], onlyA = [], onlyB = []; let i = 0, j = 0;
  while (i < n && j < m) { if (ka[i] === kb[j]) pairs.push([i++, j++]); else if (L[i + 1][j] >= L[i][j + 1]) onlyA.push(i++); else onlyB.push(j++); }
  while (i < n) onlyA.push(i++); while (j < m) onlyB.push(j++);
  // an item left over on each side at the same place in the order is one item whose text changed: pair them, so the text row says so
  for (let k = 0; k < onlyA.length; k++) { const ia = onlyA[k]; const at = onlyB.findIndex((jb) => pairs.filter(([pi]) => pi < ia).length === pairs.filter(([, pj]) => pj < jb).length && kind(A[ia].tag) === kind(B[jb].tag));
    if (at >= 0) { pairs.push([ia, onlyB[at]]); onlyB.splice(at, 1); onlyA.splice(k--, 1); } }
  pairs.sort((p, q) => p[0] - q[0]);
  return { pairs, onlyA, onlyB };
}

const browser = await chromium.launch();
let failed = 0;
for (const spec of specs) {
  const tol = spec.tol ?? 2;
  const res = { name: spec.name, checks: 0, fails: 0, widths: {} };
  for (const w of spec.widths || WIDTHS) {
    const profile = w < PHONE_BELOW ? { ...devices['iPhone 13'], viewport: { width: w, height: 844 } } : { viewport: { width: w, height: 1000 }, deviceScaleFactor: 1 };
    const ctx = await browser.newContext({ ...profile, reducedMotion: 'reduce' });
    await guard(ctx);
    const a = await measure(ctx, WP, spec.wp, false);
    const b = await measure(ctx, WF, spec.wf, !has('--no-bust'));
    await ctx.close();
    if (DUMP && a && b) fs.writeFileSync(verify('measure', `${spec.name}.${w}.dump.json`), JSON.stringify({ wp: a, wf: b }, null, 1));
    const rows = [];
    const bad = (k, x, y) => { rows.push({ k, wp: x, wf: y }); res.fails++; };
    if (!a || !b) { res.checks++; bad('block found', !!a, !!b); res.widths[w] = rows; continue; }
    const boxes = (pre, x, y) => { for (const k of ['x', 'y', 'w', 'h']) { res.checks++; if (Math.abs(x[k] - y[k]) > tol) bad(`${pre}.${k}`, x[k], y[k]); } };
    boxes('root', a.root, b.root);
    res.checks++; if (a.root.bg !== b.root.bg) bad('root.bg', a.root.bg, b.root.bg);
    res.checks++; if (a.items.length !== b.items.length) bad('item-count', a.items.length, b.items.length);
    const { pairs, onlyA, onlyB } = align(a.items, b.items);
    for (const i of onlyA) { res.checks++; bad(`#${i} ${a.items[i].tag} "${a.items[i].text.slice(0, 18)}".only on WordPress`, box4(a.items[i]), null); }
    for (const j of onlyB) { res.checks++; bad(`staging #${j} ${b.items[j].tag} "${b.items[j].text.slice(0, 18)}".only on staging`, null, box4(b.items[j])); }
    for (const [i, j] of pairs) {
      const x = a.items[i], y = b.items[j];
      const pre = `#${i} ${x.tag} "${x.text.slice(0, 18)}"`;
      res.checks++; if (x.text.replace(/\s+/g, ' ') !== y.text.replace(/\s+/g, ' ')) bad(`${pre}.text`, x.text, y.text);
      boxes(pre, x, y);
      for (const k of ['font', 'weight', 'tt', 'color', 'op', 'bw', 'radius', 'bgimg', 'bg']) { res.checks++; if (x[k] !== y[k]) bad(`${pre}.${k}`, x[k], y[k]); }
      for (const k of ['size', 'lh', 'ls']) {
        res.checks++;
        const xv = parseFloat(x[k]), yv = parseFloat(y[k]);
        if (x[k] !== y[k] && !(isNaN(xv) && isNaN(yv)) && !(Math.abs(xv - yv) <= 0.25)) bad(`${pre}.${k}`, x[k], y[k]);
      }
    }
    res.widths[w] = rows;
  }
  fs.writeFileSync(verify('measure', `${spec.name}.json`), JSON.stringify(res, null, 1));
  const first = Object.entries(res.widths).flatMap(([w, rows]) => rows.slice(0, 3).map((r) => `${w}px ${r.k} wp=${JSON.stringify(r.wp)} wf=${JSON.stringify(r.wf)}`)).slice(0, 6);
  console.log(`${spec.name}: ${res.checks} checks, ${res.fails} mismatches` + (res.fails ? ' — first: ' + first.join(' | ') : ''));
  if (res.fails) failed++;
}
await browser.close();
process.exit(failed ? 1 : 0);
