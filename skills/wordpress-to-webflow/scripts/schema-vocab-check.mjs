// schema-vocab-check.mjs — checks every JSON-LD node on the site against the official schema.org vocabulary (the
// same file the schema.org validator uses): each @type must be a schema.org class, each property must be a
// schema.org property that belongs on that class or one of its parents, and each value must fit the property's
// range (text / URL / date / number, or a class). It is a local stand-in for the online validator, which can answer
// scripts with a CAPTCHA.
//
// Usage:    node schema-vocab-check.mjs [origin] [--sitemap-origin https://host] [--config site.config.json]
//           origin: where to fetch the pages (default webflow.stagingOrigin)
//           --sitemap-origin: where to read /sitemap.xml (default site.liveOrigin)
// Inputs:   site.liveOrigin, webflow.stagingOrigin
//           checks.jsonld.vocabFile                the vocabulary file, downloaded by you once from schema.org
//                                                  (Developers page: schemaorg-current-https.jsonld)
//           checks.jsonld.skipPathRes (optional)   regular expressions for sitemap paths to leave out
// Outputs:  one line per page, then the types and properties seen. Nothing on disk.
// Exit codes: 0 no problems; 1 at least one vocabulary problem (or a block that is not valid JSON); 2 config or the
//           vocabulary file missing.
// Network:  the sitemap origin (one request) and the chosen origin (one request per page), through `curl`.
// Needs:    curl on the PATH.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { need, opt, origin, at, arg, positionals, stop } from './site.mjs';

const ORIGIN = (positionals(['--sitemap-origin'])[0] || origin('webflow.stagingOrigin')).replace(/\/$/, '');
const SITEMAP_ORIGIN = (arg('--sitemap-origin', null) || origin('site.liveOrigin')).replace(/\/$/, '');
const SKIP = opt('checks.jsonld.skipPathRes', []).map((s) => new RegExp(s));
const vocabFile = at(need('checks.jsonld.vocabFile'));
if (!fs.existsSync(vocabFile)) stop(`${vocabFile} not found (download schemaorg-current-https.jsonld from schema.org and point checks.jsonld.vocabFile at it)`);
const vocab = JSON.parse(fs.readFileSync(vocabFile, 'utf8'))['@graph'];
const id = (x) => String(x).replace(/^schema:/, '');
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const classes = {}, props = {};
for (const n of vocab) {
  const types = arr(n['@type']);
  if (types.includes('rdfs:Class')) classes[id(n['@id'])] = arr(n['rdfs:subClassOf']).map((s) => id(s['@id']));
  if (types.includes('rdf:Property')) props[id(n['@id'])] = { domain: arr(n['schema:domainIncludes']).map((d) => id(d['@id'])), range: arr(n['schema:rangeIncludes']).map((d) => id(d['@id'])), superseded: n['schema:supersededBy'] };
}
const ancestors = (c, seen = new Set()) => { if (seen.has(c)) return seen; seen.add(c); for (const p of classes[c] || []) ancestors(p, seen); return seen; };
const DATATYPES = new Set(['Text', 'URL', 'Date', 'DateTime', 'Number', 'Integer', 'Boolean', 'Time', 'CssSelectorType', 'XPathType', 'PronounceableText']);

const curl = (url) => execFileSync('curl', ['-sSL', '--max-time', '30', '-A', 'schema-check', url], { encoding: 'utf8', maxBuffer: 64 << 20 });
const pathOf = (loc) => { const u = new URL(loc); return (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '/') + u.search; };
const paths = [...new Set([...curl(`${SITEMAP_ORIGIN}/sitemap.xml`).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1])))].filter((p) => !SKIP.some((r) => r.test(p)));

let problems = 0; const seenTypes = new Set(), seenProps = new Set();
for (const path of paths) {
  const html = curl(ORIGIN + path);
  const errs = [];
  const check = (node, where) => {
    if (Array.isArray(node)) return node.forEach((n, i) => check(n, `${where}[${i}]`));
    if (!node || typeof node !== 'object') return;
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === '@id') return;                 // a reference
    const types = arr(node['@type']);
    for (const t of types) { seenTypes.add(t); if (!classes[t]) errs.push(`${where}: unknown type ${t}`); }
    const anc = new Set(types.flatMap((t) => [...ancestors(t)]));
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@')) { if (k === '@graph') check(v, '@graph'); continue; }
      seenProps.add(k);
      const p = props[k];
      if (!p) { errs.push(`${where}: unknown property ${k}`); continue; }
      if (p.superseded) errs.push(`${where}: ${k} is superseded`);
      if (!p.domain.some((d) => anc.has(d))) errs.push(`${where}: ${k} not expected on ${types.join('/')}`);
      for (const val of arr(v)) {
        if (val && typeof val === 'object') {
          const vt = arr(val['@type']);
          const ok = !vt.length || vt.some((t) => p.range.some((r) => ancestors(t).has(r)));
          if (!ok) errs.push(`${where}: ${k} value of type ${vt} outside range ${p.range}`);
          check(val, `${where}.${k}`);
        } else if (!p.range.some((r) => DATATYPES.has(r)) && !(typeof val === 'string' && /^https?:/.test(val))) {
          errs.push(`${where}: ${k} expects ${p.range.join('/')} but has a literal`);
        }
      }
    }
  };
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { errs.push('invalid JSON: ' + e.message); continue; }
    check(data, path);
  }
  problems += errs.length;
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${path}${errs.length ? '\n     - ' + errs.join('\n     - ') : ''}`);
}
console.log(`\ntypes: ${[...seenTypes].sort().join(', ')}\nproperties: ${[...seenProps].sort().join(', ')}\n${paths.length} pages, ${problems} schema.org vocabulary problem(s): ${ORIGIN}`);
process.exit(problems ? 1 : 0);
