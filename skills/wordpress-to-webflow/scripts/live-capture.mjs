// live-capture.mjs — records what the LIVE WordPress site does today for every old URL that must keep working:
// the status, every redirect hop, and the final destination. WordPress often holds redirects of its own beyond the
// host's rule list, so the live final destination is the ground truth the Webflow redirects must reproduce in one hop.
// Read-only GET requests, one at a time, about one a second. Safe to stop and run again: answers already recorded
// are kept and only the rest is fetched.
//
// Usage:    node live-capture.mjs [--config site.config.json]
// Inputs:   site.liveOrigin
//           <inventoryDir>/urls.csv                 column `path` (every WordPress URL in the inventory)
//           site.redirectRulesFile (optional)       the host's exported redirect rules: a JSON list of
//                                                   { pattern, replacement, argmatch, domain } (WP Engine's export format)
//           the live sitemap                        site.sitemapPath, default /sitemap_index.xml (child sitemaps followed)
//           capture.extraUrlFiles (optional)        [{ file, column, tag }] more CSV lists of old URLs (backups, crawls)
//           capture.searchConsolePagesFile (opt.)   a CSV with columns `page`, `impressions` (a Search Console export);
//                                                   pages with at least capture.minImpressions (default 10) are added
//           <verifyDir>/links.json (if present)     broken internal links found by crawl-links.mjs: WordPress may redirect them
// Outputs:  <verifyDir>/live-capture.json  { "/path": { from: [where the URL came from], impressions, hops: [...] } }
// Exit codes: 0 written; 2 config missing.
// Network:  the live site (site.liveOrigin). Each redirect is followed to its end, so when an old rule points at another
//           site, that destination is requested once too. A 429 (rate limit) is waited out and retried, never recorded
//           as an answer.
import fs from 'node:fs';
import { opt, origin, at, inventory, verify, readCsv } from './site.mjs';

const LIVE = origin('site.liveOrigin');
const HOST = new URL(LIVE).host;
const OUT = verify('live-capture.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const GAP = opt('capture.gapMs', 1200);   // one request at a time, about one a second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bare = (h) => h.replace(/^www\./, '');
const toPath = (u) => {
  try { const x = new URL(u, LIVE); return bare(x.host) === bare(HOST) ? x.pathname + x.search : null; } catch { return null; }
};

const src = new Map();   // path → Set(where it came from)
const add = (p, tag) => { if (!p) return; if (!src.has(p)) src.set(p, new Set()); src.get(p).add(tag); };

for (const r of readCsv(inventory('urls.csv'))) add(r.path, 'inventory');
for (const x of opt('capture.extraUrlFiles', [])) for (const r of readCsv(at(x.file))) add(toPath(r[x.column || 'url']), x.tag || 'extra');

const imp = {};
const gscFile = opt('capture.searchConsolePagesFile', null);
if (gscFile) {
  const min = opt('capture.minImpressions', 10);
  for (const r of readCsv(at(gscFile))) {
    if (+r.impressions < min) continue;
    const p = toPath(r.page); add(p, 'gsc');
    if (p) imp[p] = (imp[p] || 0) + +r.impressions;
  }
}

const rulesFile = opt('site.redirectRulesFile', null);
const rules = rulesFile ? JSON.parse(fs.readFileSync(at(rulesFile), 'utf8')) : [];
rules.forEach((r, i) => {
  // a source that can be listed: an anchored literal path (\/ unescaped, optional trailing slash dropped), or a literal prefix rule
  const lit = r.pattern.replace(/\\\//g, '/').replace(/\\\./g, '.').replace(/\/\?\$$/, '/').replace(/\$$/, '');
  if (/^\^\/[^()*+?[\]|{}\\^$]*$/.test(lit)) add(lit.slice(1) + (r.argmatch ? '?' + r.argmatch : ''), 'rule#' + (i + 1));
});

async function sitemapUrls() {
  const seen = new Set(); const urls = []; const queue = [LIVE + opt('site.sitemapPath', '/sitemap_index.xml')];
  while (queue.length) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u);
    try {
      const t = await (await fetch(u, { headers: { 'user-agent': UA } })).text();
      for (const m of t.matchAll(/<loc>([^<]+)<\/loc>/g)) (m[1].endsWith('.xml') ? queue : urls).push(m[1]);
    } catch { /* a sitemap that cannot be read adds nothing */ }
  }
  return urls;
}
for (const u of await sitemapUrls()) add(toPath(u), 'live-sitemap');

// internal links in the content that 404 on staging (crawl-links.mjs): WordPress may redirect them itself
const linksFile = verify('links.json');
if (fs.existsSync(linksFile)) for (const b of JSON.parse(fs.readFileSync(linksFile, 'utf8')).broken) add(b.url.endsWith('/') ? b.url : b.url + '/', 'content-link');

async function chase(path) {
  const hops = []; let url = LIVE + path;
  for (let i = 0; i < 10; i++) {
    let res;
    for (let t = 0; ; t++) {   // the live host may rate-limit (429): wait and retry, never record a 429 as an answer
      try { res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } }); } catch (e) { hops.push({ url, error: e.message }); return { hops }; }
      if (res.status !== 429 || t > 8) break;
      await res.body?.cancel();
      await sleep(Math.max(+res.headers.get('retry-after') || 0, 20) * 1000);
    }
    await sleep(GAP);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      hops.push({ url, status: res.status, location: new URL(loc, url).href });
      url = new URL(loc, url).href;
      await res.body?.cancel();
      continue;
    }
    let title = '';
    if (res.status === 200 && /html/.test(res.headers.get('content-type') || '')) {
      const t = await res.text();
      title = (t.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
    } else await res.body?.cancel();
    hops.push({ url, status: res.status, title, type: res.headers.get('content-type') || '' });
    break;
  }
  return { hops };
}

// resume: keep earlier answers (not 429s or errors) from a previous run
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const done = (r) => r && r.hops.length && r.hops.every((h) => h.status && h.status !== 429);
const out = {};
for (const p of src.keys()) if (done(prev[p])) out[p] = { ...prev[p], from: [...src.get(p)], impressions: imp[p] || 0 };
const list = [...src.keys()].filter((p) => !out[p]);
console.log(list.length, 'to fetch');
const save = () => fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
let n = 0;
while (list.length) {
  const p = list.shift();
  out[p] = { from: [...src.get(p)], impressions: imp[p] || 0, ...(await chase(p)) };
  if (++n % 50 === 0) { console.log(n, 'done'); save(); }
}
save();
const last = (r) => r.hops.at(-1) || {};
console.log(Object.keys(out).length, 'sources;', Object.values(out).filter((r) => r.hops.length > 1).length, 'redirect on live;',
  Object.values(out).filter((r) => last(r).status === 404).length, 'end 404 →', OUT);
