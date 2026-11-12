// staging-paths.mjs — lists every path Webflow serves as a page: published static pages (drafts and the 401/404
// utility pages left out) plus every published CMS item under its collection's path. The redirect builder and the
// link, SEO and sitemap checks all read this list. A redirect may only point at one of these paths, and its old path
// must not be one of them (Webflow lets a page win over a redirect).
//
// Usage:    node staging-paths.mjs [--config site.config.json]
// Inputs:   WEBFLOW_TOKEN (environment), webflow.siteId, webflow.stagingOrigin.
//           Optional: <verifyDir>/page-paths.json  { "<page id>": "/folder/page" }. The API's page list does not
//           include folders, so a page inside a folder needs its full path given here; without an entry the path is
//           built from the page's own slug and its parent pages' slugs.
// Outputs:  <verifyDir>/staging-paths.json  { "/path": { kind: "page" | "item", id, title, collection? } }
// Exit codes: 0 written; 2 config or token missing; 1 an API call failed.
// Network:  reads the Webflow API, and sends one HEAD request per collection to the staging site (to see whether
//           that collection's item pages are switched on).
import fs from 'node:fs';
import { need, origin, verify } from './site.mjs';
import { api } from './wf-api.mjs';

const SITE = need('webflow.siteId');
const STAGING = origin('webflow.stagingOrigin');

async function list(path, key) {
  const out = [];
  for (let off = 0; ; off += 100) {
    const j = await api('GET', path + (path.includes('?') ? '&' : '?') + 'limit=100&offset=' + off);
    out.push(...j[key]);
    if (out.length >= (j.pagination?.total ?? 0) || !j[key].length) return out;
  }
}

const pages = await list(`/sites/${SITE}/pages`, 'pages');
const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
const knownFile = verify('page-paths.json');
const known = fs.existsSync(knownFile) ? JSON.parse(fs.readFileSync(knownFile, 'utf8')) : {};
const pathOf = (p) => {
  if (known[p.id]) return known[p.id];
  const parts = [];
  for (let x = p; x; x = byId[x.parentId]) parts.unshift(x.slug);
  return '/' + parts.join('/');
};

const out = {};
for (const p of pages) {
  if (p.draft || p.archived || p.collectionId) continue;
  const path = p.slug === '' || (!p.parentId && p.slug === 'index') ? '/' : pathOf(p);
  if (/^\/(401|404|search)$/.test(path) && p.slug !== 'search') continue;   // utility pages (search is served at /search)
  out[path] = { kind: 'page', id: p.id, title: p.title };
}
// collection templates: one per collection; CMS item URLs are /<collection slug>/<item slug>
for (const t of pages.filter((p) => p.collectionId && !p.draft)) {
  const prefix = '/' + (await api('GET', `/collections/${t.collectionId}`)).slug;
  const items = await list(`/collections/${t.collectionId}/items/live`, 'items').catch(() => []);
  // a collection whose template page is switched off serves no item pages: probe one item on staging
  if (items.length && (await fetch(STAGING + prefix + '/' + items[0].fieldData.slug, { method: 'HEAD' })).status === 404) {
    console.log('no item pages:', prefix);
    continue;
  }
  for (const it of items) out[prefix + '/' + it.fieldData.slug] = { kind: 'item', id: it.id, collection: t.collectionId, title: it.fieldData.name };
}

const file = verify('staging-paths.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
const count = {};
for (const [k, v] of Object.entries(out)) { const top = v.kind === 'page' ? 'pages' : k.split('/')[1]; count[top] = (count[top] || 0) + 1; }
console.log(Object.keys(out).length, 'paths', JSON.stringify(count), '→', file);
