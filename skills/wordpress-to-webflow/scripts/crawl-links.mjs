// crawl-links.mjs — links and media on every staging page, in two passes:
//   1. HTML pass (plain fetch): every href / src / srcset / poster / action / data-* URL and CSS url() on the page.
//      Internal links must resolve (200, or a redirect ending in 200). Any reference to the old WordPress host is a
//      failure: the local copy anywhere, and the production host when it is used as a resource (an image, script or
//      stylesheet) or links to an old upload. Canonical, og:url and JSON-LD identity URLs are meant to name the
//      production domain and are allowed. JSON-LD must parse and must not point at the old uploads folder.
//   2. Browser pass (Playwright, Chromium, 1440 wide) with every request to the old hosts BLOCKED: nothing visible
//      may break (blocked requests and broken images are counted per page).
//
// Usage:    node crawl-links.mjs [--only substring] [--config site.config.json]
// Inputs:   site.liveOrigin, webflow.stagingOrigin, wordpress.localOrigin (optional)
//           <verifyDir>/staging-paths.json                 from staging-paths.mjs
//           checks.browserPassSkipPrefixes (optional)      path prefixes left out of the browser pass (for example
//                                                          collections whose item pages are bare support pages)
// Outputs:  <verifyDir>/links.json and <verifyDir>/links.md
// Exit codes: 0 nothing broken; 1 a broken link, an old-host reference or a page that breaks with the old host
//           blocked; 2 config or input missing.
// Network:  the staging origin only (requests to the old hosts are blocked in the browser pass).
// Needs:    playwright (npm install, then npx playwright install chromium).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { opt, origin, verify, arg, readJson, oldHosts } from './site.mjs';

const WF = origin('webflow.stagingOrigin');
const only = arg('--only', null);
const paths = Object.keys(readJson(verify('staging-paths.json'), 'staging-paths.mjs')).filter((p) => !only || p.includes(only));
const { live: LIVE_HOSTS, local: WP_HOST } = oldHosts();
const STG = new URL(WF).host;
const UPLOADS = opt('wordpress.uploadsPath', '/wp-content/uploads/');
const OLD_CONTENT = new RegExp(UPLOADS.replace(/\/uploads\/?$/, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));   // /wp-content/
const SKIP = opt('checks.browserPassSkipPrefixes', []);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&quot;/g, '"');

const refs = new Map();   // internal link → Set(pages it is on)
const bad = [];           // { page, kind, url }
for (const path of paths) {
  const html = await (await fetch(WF + path)).text();
  const urls = [];
  for (const m of html.matchAll(/\s(href|src|poster|action|data-[a-z-]+)="([^"]+)"/g)) urls.push([m[1], decode(m[2])]);
  for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) for (const part of decode(m[1]).split(',')) urls.push(['srcset', part.trim().split(/\s+/)[0]]);
  for (const m of html.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) urls.push(['css', decode(m[2])]);
  const identity = new Set();
  for (const m of html.matchAll(/<link rel="canonical" href="([^"]+)"|<meta property="og:url" content="([^"]+)"/g)) identity.add(m[1] || m[2]);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { bad.push({ page: path, kind: 'json-ld', url: 'does not parse' }); }
    for (const u of m[1].matchAll(/"(https?:\/\/[^"]+)"/g)) if ((WP_HOST && u[1].includes(WP_HOST)) || OLD_CONTENT.test(u[1])) bad.push({ page: path, kind: 'json-ld', url: u[1] });
  }
  for (const [kind, u] of urls) {
    if (!u || /^(#|mailto:|tel:|javascript:|data:|\{)/.test(u)) continue;
    let abs; try { abs = new URL(u, WF + path); } catch { continue; }
    if (abs.host === WP_HOST || abs.host.startsWith('localhost')) { bad.push({ page: path, kind, url: abs.href }); continue; }
    if (LIVE_HOSTS.includes(abs.host)) {
      if (!identity.has(u) && kind !== 'href') bad.push({ page: path, kind: kind + ' (production host as a resource)', url: abs.href });
      else if (kind === 'href' && OLD_CONTENT.test(abs.pathname)) bad.push({ page: path, kind: 'href to an old upload', url: abs.href });
      continue;
    }
    if (abs.host !== STG || kind !== 'href') continue;
    const key = abs.pathname + abs.search;
    if (!refs.has(key)) refs.set(key, new Set());
    refs.get(key).add(path);
  }
}

// resolve each internal link once
const broken = [];
const queue = [...refs.keys()];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (queue.length) {
    const k = queue.shift();
    const r = await fetch(WF + k, { redirect: 'follow' }).catch(() => null);
    if (!r || r.status !== 200) broken.push({ url: k, status: r?.status ?? 'error', from: [...refs.get(k)].slice(0, 5) });
    await r?.body?.cancel();
  }
}));

// browser pass with the old hosts blocked
const isOld = (host) => LIVE_HOSTS.includes(host) || host === WP_HOST;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route((url) => isOld(url.host), (route) => route.abort());
const blocked = [];
for (const path of paths.filter((p) => !SKIP.some((pre) => p.startsWith(pre)))) {
  const page = await ctx.newPage(); const fails = [];
  page.on('requestfailed', (r) => { if (isOld(new URL(r.url()).host)) fails.push(r.resourceType() + ' ' + r.url()); });
  await page.goto(WF + path, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 900) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } }).catch(() => {});
  const brokenImgs = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc && i.getBoundingClientRect().width > 0).map((i) => i.currentSrc)).catch(() => []);
  if (fails.length || brokenImgs.length) blocked.push({ page: path, blockedRequests: [...new Set(fails)].slice(0, 5), brokenImages: brokenImgs.slice(0, 5) });
  await page.close();
}
await browser.close();

const out = { pages: paths.length, internalLinks: refs.size, broken, oldHostRefs: bad, blockedPass: blocked };
fs.writeFileSync(verify('links.json'), JSON.stringify(out, null, 1));
const md = [`# Links and media`, ``,
  `${paths.length} pages, ${refs.size} distinct internal links. Broken: **${broken.length}**. References to the WordPress host: **${bad.length}**. Pages with something broken when ${LIVE_HOSTS[0]} is blocked: **${blocked.length}**.`, ``,
  ...broken.map((x) => `- broken ${x.status} ${x.url} (from ${x.from.join(', ')})`),
  ...bad.map((x) => `- old host: ${x.page} ${x.kind} ${x.url}`),
  ...blocked.map((x) => `- blocked pass: ${x.page} ${x.blockedRequests.join(' ')} ${x.brokenImages.join(' ')}`)].join('\n');
fs.writeFileSync(verify('links.md'), md + '\n');
console.log(md.split('\n').slice(0, 40).join('\n'));
process.exit(broken.length || bad.length || blocked.length ? 1 : 0);
