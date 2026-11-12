// verify-jsonld.mjs — checks the JSON-LD (schema markup) on every page of a Webflow site as served, without running
// JavaScript. For each URL in the sitemap, plus /404, fetched on the chosen origin:
//   - a page that answers 404 must carry NO JSON-LD; every other page must carry at least one block (or exactly
//     checks.jsonld.blocksPerPage when that is set);
//   - every block is valid JSON;
//   - every { "@id": … } reference resolves to a node defined on the same page (or is a known external id);
//   - no value is empty or still a Webflow placeholder ({{wf …}}, w-dyn-bind-empty) or a leftover &quot;;
//   - every text value appears on that page, elsewhere on the site, or in one of your facts files, unless it is a
//     URL, a date or a schema keyword. Markup must describe what the site says, not invent it;
//   - every URL on the site's own domain in the markup is a sitemap page that answers 200 (image and PDF URLs aside).
//
// Usage:    node verify-jsonld.mjs [origin] [--sitemap-origin https://host] [--config site.config.json]
//           origin: where to fetch the pages (default webflow.stagingOrigin; pass the live origin after publishing)
//           --sitemap-origin: where to read /sitemap.xml (default site.liveOrigin)
// Inputs:   site.liveOrigin (the canonical domain the markup names), webflow.stagingOrigin
//           checks.jsonld.factsFiles (optional)    local files (text, JSON or saved HTML) holding facts the markup may
//                                                  state that are not on the site, e.g. a saved company-register page
//           checks.jsonld.externalIds (optional)   @id values defined on another site (a parent organisation)
//           checks.jsonld.keywords (optional)      short values that need no source: language and country codes
//           checks.jsonld.skipPathRes (optional)   regular expressions for sitemap paths to leave out
//           checks.jsonld.blocksPerPage (optional) the exact number of blocks every page must carry
// Outputs:  <verifyDir>/jsonld-check-<host>.json and one line per page
// Exit codes: 0 no problems; 1 at least one problem; 2 config missing.
// Network:  the sitemap origin (one request) and the chosen origin (one request per page), through `curl`.
// Needs:    curl on the PATH.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { opt, origin, at, verify, arg, positionals } from './site.mjs';

const ORIGIN = (positionals(['--sitemap-origin'])[0] || origin('webflow.stagingOrigin')).replace(/\/$/, '');
const LIVE = origin('site.liveOrigin');
const SITEMAP_ORIGIN = (arg('--sitemap-origin', null) || LIVE).replace(/\/$/, '');
const EXTERNAL_IDS = new Set(opt('checks.jsonld.externalIds', []));
const KEYWORDS = new Set(['https://schema.org', ...opt('checks.jsonld.keywords', [])]);
const SKIP = opt('checks.jsonld.skipPathRes', []).map((s) => new RegExp(s));
const BLOCKS = opt('checks.jsonld.blocksPerPage', null);

const curlCode = (url) => {
  const out = execFileSync('curl', ['-sSL', '--max-time', '30', '-A', 'schema-check', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const i = out.lastIndexOf('\n');
  return [Number(out.slice(i + 1)), out.slice(0, i)];
};
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const norm = (s) => decode(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
const textOf = (html) => norm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')) + ' ' +
  norm([...html.matchAll(/<(?:meta|img)\b[^>]*?(?:content|alt)="([^"]*)"/gi)].map((m) => m[1]).join(' ')) + ' ' +
  norm((html.match(/<title>([\s\S]*?)<\/title>/) || ['', ''])[1]);

const [, sitemap] = curlCode(`${SITEMAP_ORIGIN}/sitemap.xml`);
const pathOf = (loc) => { const u = new URL(loc); return (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '/') + u.search; };
const paths = [...new Set([...[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1])), '/404'])].filter((p) => !SKIP.some((r) => r.test(p)));

const pages = {};
for (const p of paths) pages[p] = curlCode(ORIGIN + p);
const siteText = Object.values(pages).map(([, h]) => textOf(h)).join(' ');
const factsText = opt('checks.jsonld.factsFiles', []).map((f) => { const t = fs.readFileSync(at(f), 'utf8'); return /\.html?$/i.test(f) ? textOf(t) : norm(t); }).join(' ');
const isUrl = (s) => /^https?:\/\/\S+$/.test(s);
const isDate = (s) => /^\d{4}(-\d\d(-\d\d([T ][\d:.]+Z?)?)?)?$/.test(s);
const okPages = new Set(Object.entries(pages).filter(([, [c]]) => c === 200).map(([p]) => p));
const ownUrl = new RegExp('"(' + LIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[/"#?])[^"#]*)', 'g');

const results = []; let failures = 0; let nodes = 0;
for (const [path, [code, html]] of Object.entries(pages)) {
  const r = { path, status: code, blocks: 0, types: [], errors: [] };
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  r.blocks = blocks.length;
  const is404 = code === 404 || path === '/404';
  if (is404 && blocks.length) r.errors.push('JSON-LD on a 404 page');
  if (!is404 && BLOCKS !== null && blocks.length !== BLOCKS) r.errors.push(`expected ${BLOCKS} JSON-LD block(s), found ${blocks.length}`);
  if (!is404 && BLOCKS === null && !blocks.length) r.errors.push('no JSON-LD block');
  const pageText = textOf(html);
  const defined = new Set(); const refs = [];
  const walk = (v, key, parentType) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key, parentType));
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (v['@type']) { r.types.push(v['@type']); nodes++; }
      if (v['@id'] && keys.length === 1) refs.push(v['@id']);
      else if (v['@id']) defined.add(v['@id']);
      for (const [k, x] of Object.entries(v)) walk(x, k, v['@type'] || parentType);
      return;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return;
    if (typeof v !== 'string') return r.errors.push(`${key}: unexpected ${typeof v}`);
    if (!v.trim()) return r.errors.push(`${key} (${parentType}): empty`);
    if (/\{\{\s*wf|w-dyn-bind-empty|&quot;/.test(v)) return r.errors.push(`${key} (${parentType}): placeholder or entity left: ${v}`);
    if (key === '@type' || key === '@context' || key === '@id' || KEYWORDS.has(v) || isUrl(v) || isDate(v)) return;
    const n = norm(v);
    const where = pageText.includes(n) ? 'page' : siteText.includes(n) ? 'site' : factsText.includes(n) ? 'facts' : null;
    if (!where) r.errors.push(`${key} (${parentType}): "${v}" not found on the page, the site or the facts files`);
  };
  for (const b of blocks) {
    let data;
    try { data = JSON.parse(b); } catch (e) { r.errors.push('invalid JSON: ' + e.message); continue; }
    walk(data, 'root', null);
  }
  for (const id of refs) if (!defined.has(id) && !EXTERNAL_IDS.has(id)) r.errors.push(`@id ${id} referenced but not defined on this page`);
  // URLs pointing at this site must be real pages on it
  for (const m of blocks.join(' ').matchAll(ownUrl)) {
    const u = pathOf(m[1]);
    if (!okPages.has(u) && !/\.(png|svg|webp|jpe?g|gif|avif|pdf)$/i.test(u)) r.errors.push(`URL ${m[1]} is not a 200 page in the sitemap`);
  }
  r.types = [...new Set(r.types.flat())];
  failures += r.errors.length;
  results.push(r);
}
const file = verify(`jsonld-check-${new URL(ORIGIN).host.replace(/:/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify({ origin: ORIGIN, at: new Date().toISOString(), failures, nodes, results }, null, 2) + '\n');
for (const r of results) console.log(`${r.errors.length ? 'FAIL' : 'ok  '} ${r.status} ${r.path.slice(0, 66).padEnd(66)} ${r.blocks} block ${r.types.join(', ')}${r.errors.length ? '\n     - ' + r.errors.join('\n     - ') : ''}`);
const marked = results.filter((r) => r.blocks).length;
console.log(`\n${results.length} URLs (${marked} with markup, ${results.length - marked} without), ${nodes} typed nodes, ${failures} problem(s): ${ORIGIN} → ${file}`);
process.exit(failures ? 1 : 0);
