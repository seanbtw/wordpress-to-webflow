// measure-blocks.mjs — compares a block on the local WordPress copy with the same block on Webflow staging by
// measured values, not by picture. It walks both blocks in document order, pairs their "content" elements by
// position (elements with their own text, media, form fields, or a background, background image or border), and
// compares each pair: box relative to the block (x, y, width, height), font family, size, weight, line height,
// letter spacing, text transform, colour, background colour and image, border widths, radius and opacity.
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
//  - Only the staging URL gets a cache-busting query. On the WordPress side a stray query parameter can change the
//    page (a listing that reads every parameter as a filter).
//  - Reduced motion is on, so sliders rest on their first slide.
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
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    for (const h of hide) document.querySelectorAll(h).forEach((e) => (e.style.display = 'none'));
    const root = document.querySelectorAll(sel)[index];
    if (!root) return null;
    document.documentElement.style.scrollBehavior = 'auto';
    root.scrollIntoView({ behavior: 'instant', block: 'start' });
    await new Promise((done) => setTimeout(done, 300));
    const R = root.getBoundingClientRect();
    const r1 = (n) => Math.round(n * 10) / 10;
    const box = (e) => { const b = e.getBoundingClientRect(); return { x: r1(b.left - R.left), y: r1(b.top - R.top), w: r1(b.width), h: r1(b.height) }; };
    const shown = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; };
    const hasBox = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const skipped = (e) => SKIP_WITHIN && e.closest(SKIP_WITHIN);
    const borders = (s) => ['Top', 'Right', 'Bottom', 'Left'].map((d) => (s[`border${d}Style`] === 'none' ? 0 : parseFloat(s[`border${d}Width`]))).join(' ');
    const bgName = (s) => (s.backgroundImage.match(/([^/"']+)["']?\)\s*$/) || [])[1] || '';
    const family = (s) => s.fontFamily.split(',')[0].replace(/"/g, '');
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
          const leaves = [...c.querySelectorAll('*')].filter((x) => !skipped(x) && !x.closest('svg') && x.children.length === 0 && x.textContent.trim());
          const label = leaves.pop() || c; const s = getComputedStyle(c), l = getComputedStyle(label);
          items.push({ tag: 'button', text: (label.textContent || '').trim().slice(0, 40), ...box(c), font: family(l), size: l.fontSize, weight: l.fontWeight,
            lh: l.lineHeight, ls: s.letterSpacing, tt: s.textTransform, color: l.color, bg: s.backgroundColor, bgimg: bgName(s), bw: borders(s), radius: s.borderTopLeftRadius, op: s.opacity });
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
            radius: s.borderTopLeftRadius, op: s.opacity });
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
    const b = await measure(ctx, WF, spec.wf, true);
    await ctx.close();
    if (DUMP && a && b) fs.writeFileSync(verify('measure', `${spec.name}.${w}.dump.json`), JSON.stringify({ wp: a, wf: b }, null, 1));
    const rows = [];
    const bad = (k, x, y) => { rows.push({ k, wp: x, wf: y }); res.fails++; };
    if (!a || !b) { res.checks++; bad('block found', !!a, !!b); res.widths[w] = rows; continue; }
    const boxes = (pre, x, y) => { for (const k of ['x', 'y', 'w', 'h']) { res.checks++; if (Math.abs(x[k] - y[k]) > tol) bad(`${pre}.${k}`, x[k], y[k]); } };
    boxes('root', a.root, b.root);
    res.checks++; if (a.root.bg !== b.root.bg) bad('root.bg', a.root.bg, b.root.bg);
    res.checks++; if (a.items.length !== b.items.length) bad('item-count', a.items.length, b.items.length);
    for (let i = 0; i < Math.min(a.items.length, b.items.length); i++) {
      const x = a.items[i], y = b.items[i];
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
