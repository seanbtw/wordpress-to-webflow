// seo-check.mjs — SEO basics on every staging page, read from the served HTML (no JavaScript run):
//   - exactly one <h1>;
//   - <title> and meta description equal the WordPress values in the inventory (equal means equal);
//   - every JSON-LD block parses, and the types the config asks for are there (for example exactly one Organization
//     on every page, an Article on every post);
//   - every <img> has alt text where the inventory has alt text for that file;
//   - /sitemap.xml lists exactly the pages checked (no page missing, nothing extra);
//   - the pages named in the config show their main text without JavaScript: a sentence taken from the local
//     WordPress copy of the page must be in the staging HTML.
//
// Usage:    node seo-check.mjs [--config site.config.json]
// Inputs:   webflow.stagingOrigin
//           <verifyDir>/staging-paths.json            from staging-paths.mjs
//           <inventoryDir>/seo.csv                    columns path, title, description
//           <inventoryDir>/assets.csv + media-manifest.json (optional, both needed for the alt check):
//                                                     assets.csv columns file, alt; the manifest maps each file to
//                                                     [{ destination }] (its new URL)
//           checks.excludePathRes (optional)          regular expressions for paths to leave out (test pages,
//                                                     collections that are not meant to be indexed)
//           checks.seo.skipTitleFor (optional)        paths whose title and description are not compared
//           checks.seo.jsonldExpect (optional)        [{ pathRe, type, count }] a type that must be on matching pages:
//                                                     exactly `count` times when count is given, else at least once
//           checks.seo.noJsTextPaths (optional)       paths for the text-without-JavaScript check; these also need
//                                                     wordpress.localOrigin. checks.seo.wpContentMarker (optional) is
//                                                     a string in the WordPress HTML where the page body starts
//                                                     (default: the <main element)
// Outputs:  <verifyDir>/seo-check.json and <verifyDir>/seo-check.md
// Exit codes: 0 everything passed; 1 a page failed, the sitemap differs or a text probe was not found; 2 config or
//           input missing.
// Network:  the staging origin, and the local WordPress copy for the text-without-JavaScript pages.
import fs from 'node:fs';
import { opt, origin, inventory, verify, readCsv, readJson } from './site.mjs';

const WF = origin('webflow.stagingOrigin');
const dec = (s) => (s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (p) => (p.length > 1 ? p.replace(/\/$/, '') : p);

const stg = readJson(verify('staging-paths.json'), 'staging-paths.mjs');
const seo = {};
for (const r of readCsv(inventory('seo.csv'))) if (!seo[norm(r.path)]) seo[norm(r.path)] = r;

// alt text by new URL, when the inventory has both files
const altOf = {};
if (fs.existsSync(inventory('assets.csv')) && fs.existsSync(inventory('media-manifest.json'))) {
  const assets = {};
  for (const a of readCsv(inventory('assets.csv'))) assets[a.file] = a.alt;
  for (const [key, uses] of Object.entries(JSON.parse(fs.readFileSync(inventory('media-manifest.json'), 'utf8')))) for (const u of uses) if (assets[key]) altOf[u.destination] = assets[key];
}

const EXCLUDE = opt('checks.excludePathRes', []).map((s) => new RegExp(s));
const SKIP_TITLE = new Set(opt('checks.seo.skipTitleFor', []));
const EXPECT = opt('checks.seo.jsonldExpect', []).map((e) => ({ ...e, re: new RegExp(e.pathRe) }));
const NOJS = opt('checks.seo.noJsTextPaths', []);

const typesOf = (blocks) => {
  const out = [];
  for (const j of blocks) for (const node of (j && typeof j === 'object' && Array.isArray(j['@graph']) ? j['@graph'] : Array.isArray(j) ? j : [j])) {
    if (node && typeof node === 'object') out.push(...[].concat(node['@type'] ?? []));
  }
  return out;
};

const out = [];
const paths = Object.keys(stg).filter((p) => !EXCLUDE.some((re) => re.test(p)));
const queue = [...paths];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const p = queue.shift(); const fails = [];
    let html = '';
    for (let t = 0; t < 8; t++) {
      const r = await fetch(WF + p);
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 5000 * (t + 1))); continue; }
      html = await r.text();
      if (r.status !== 200) fails.push('status ' + r.status);
      break;
    }
    const h1 = (html.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) fails.push(`${h1} h1`);
    const title = dec((html.match(/<title>([^<]*)<\/title>/) || [])[1]);
    const desc = dec((html.match(/<meta content="([^"]*)" name="description"/) || html.match(/<meta name="description" content="([^"]*)"/) || [])[1]);
    const s = seo[p];
    if (s && !SKIP_TITLE.has(p)) {
      if (dec(s.title) !== title) fails.push(`title "${title}" ≠ "${dec(s.title)}"`);
      if (dec(s.description) && dec(s.description) !== desc) fails.push(`description differs`);
    }
    const lds = [];
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      try { lds.push(JSON.parse(m[1])); } catch { fails.push('JSON-LD does not parse'); }
    }
    const types = typesOf(lds);
    for (const e of EXPECT) {
      if (!e.re.test(p)) continue;
      const n = types.filter((t) => t === e.type).length;
      if (e.count !== undefined ? n !== e.count : n < 1) fails.push(e.count !== undefined ? `${n} ${e.type} blocks (want ${e.count})` : `no ${e.type}`);
    }
    for (const m of html.matchAll(/<img [^>]*>/g)) {
      const src = (m[0].match(/src="([^"]+)"/) || [])[1]; const alt = (m[0].match(/alt="([^"]*)"/) || [])[1];
      if (src && altOf[src] && !alt) fails.push('img without alt ' + src.split('/').pop());
    }
    out.push({ path: p, ok: !fails.length, fails, title, h1 });
  }
}));

// the sitemap must list exactly the pages checked
const sm = await (await fetch(WF + '/sitemap.xml')).text();
const listed = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => norm(new URL(m[1]).pathname)));
const indexable = new Set(paths.filter((p) => !out.find((o) => o.path === p)?.fails.some((f) => f.startsWith('status'))));
const notListed = [...indexable].filter((p) => !listed.has(p));
const extra = [...listed].filter((p) => !indexable.has(p));

// text without JavaScript: a sentence of WordPress's own text from each named page
const noJs = [];
if (NOJS.length) {
  const WP = origin('wordpress.localOrigin');
  const marker = opt('checks.seo.wpContentMarker', null);
  for (const p of NOJS) {
    const wp = await (await fetch(WP + p + '/')).text();
    const at = marker && wp.indexOf(marker) > 0 ? wp.indexOf(marker) : wp.indexOf('<main');
    const main = wp.slice(Math.max(at, 0));
    const sentence = [...main.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => dec(m[1].replace(/<[^>]+>/g, ''))).find((t) => t.length > 80 && !/cookie/i.test(t));
    const wf = dec((await (await fetch(WF + p)).text()).replace(/<[^>]+>/g, ' '));
    const probe = sentence ? sentence.slice(0, 70) : null;
    noJs.push({ path: p, ok: !!probe && wf.includes(probe), probe });
  }
}

const bad = out.filter((o) => !o.ok);
const res = { pages: out.length, pass: out.length - bad.length, bad, sitemap: { listed: listed.size, indexable: indexable.size, notListed, extra }, noJs };
fs.writeFileSync(verify('seo-check.json'), JSON.stringify(res, null, 1));
const md = [`# SEO check`, '',
  `${res.pass} / ${res.pages} pages pass (one h1, title + description = seo.csv, JSON-LD, img alt).`,
  `Sitemap: ${listed.size} listed, ${indexable.size} indexable pages; missing ${notListed.length}, extra ${extra.length}.`,
  `Text without JavaScript: ${noJs.filter((x) => x.ok).length} / ${noJs.length}${noJs.length ? ` (${noJs.map((x) => x.path + (x.ok ? ' ✓' : ' ✗')).join(', ')})` : ''}.`, '',
  ...bad.slice(0, 80).map((b) => `- ${b.path}: ${b.fails.slice(0, 3).join('; ')}`),
  ...notListed.map((p) => `- not in sitemap: ${p}`),
  ...extra.map((p) => `- in sitemap but not indexable: ${p}`)].join('\n');
fs.writeFileSync(verify('seo-check.md'), md + '\n');
console.log(md.split('\n').slice(0, 40).join('\n'));
process.exit(bad.length || notListed.length || extra.length || noJs.some((x) => !x.ok) ? 1 : 0);
