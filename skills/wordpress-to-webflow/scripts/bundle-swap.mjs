// bundle-swap.mjs — tests a script and stylesheet bundle that has been built but not released, on the REAL staging
// pages. Every staging document is fetched as normal; in its HTML the released bundle's stylesheet and script lines
// are pointed at the local build (with that build's integrity hashes), and those two files are served from disk.
// Nothing on the staging site or the release host changes.
//
// Usage:    import { chromium } from 'playwright';
//           import { swapContext } from './bundle-swap.mjs';
//           const ctx = await swapContext(await chromium.launch(), { viewport: { width: 1440, height: 900 } }, '<hash>');
//           const page = await ctx.newPage(); await page.goto('<staging origin>/some-page');
//           The third argument is optional: when given it must equal the hash in latest.json (a guard against
//           testing a different build from the one you think).
// Inputs:   webflow.stagingOrigin
//           release.assetsOrigin    where released bundles are served: <assetsOrigin>/<hash>/<bundleName>.min.js and .css
//           release.bundleName      the bundle's file name without extension
//           release.distDir         the local build folder. It holds latest.json { "hash", "sri_js", "sri_css" } and
//                                   <hash>/<bundleName>.min.js and <hash>/<bundleName>.css
// Outputs:  a Playwright browser context with the swap in place. Nothing on disk.
// Exit codes: none of its own (2 from the config loader when a key is missing). Throws when the hash asked for is
//           not the one in latest.json.
// Network:  whatever the test then loads; the two bundle files are answered from disk.
import fs from 'node:fs';
import path from 'node:path';
import { need, origin, at } from './site.mjs';

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function swapContext(browser, opts, hash) {
  const DIST = at(need('release.distDir'));
  const NAME = need('release.bundleName');
  const assetsHost = reEsc(new URL(origin('release.assetsOrigin')).host);
  const stagingHost = reEsc(new URL(origin('webflow.stagingOrigin')).host);
  const name = reEsc(NAME);
  const L = JSON.parse(fs.readFileSync(path.join(DIST, 'latest.json'), 'utf8'));
  if (hash && hash !== L.hash) throw new Error('latest.json in ' + DIST + ' is ' + L.hash + ', asked for ' + hash);
  const ctx = await browser.newContext(opts);
  // the bundle's two files: answered from the local build
  await ctx.route(new RegExp(`${assetsHost}\\/[0-9a-f]+\\/${name}\\.(min\\.js|css)`), async (route) => {
    const f = route.request().url().match(new RegExp(`\\/([0-9a-f]+)\\/(${name}\\.(?:min\\.js|css))`));
    if (f[1] !== L.hash) return route.continue();
    route.fulfill({ status: 200, contentType: f[2].endsWith('.css') ? 'text/css' : 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(DIST, L.hash, f[2])) });
  });
  // staging documents: the released bundle's lines are pointed at the local build
  await ctx.route(new RegExp(`${stagingHost}\\/[^.]*(\\?.*)?$`), async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const r = await route.fetch();
    let html = await r.text();
    html = html.replace(new RegExp(`([0-9a-f]+)\\/${name}\\.css" integrity="[^"]+"`), `${L.hash}/${NAME}.css" integrity="${L.sri_css}"`)
      .replace(new RegExp(`([0-9a-f]+)\\/${name}\\.min\\.js" integrity="[^"]+"`), `${L.hash}/${NAME}.min.js" integrity="${L.sri_js}"`);
    route.fulfill({ response: r, body: html, headers: { ...r.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  return ctx;
}
