// sitemap-exclude.mjs — keeps the items of the collections you name out of Webflow's auto-generated sitemap.
// In Webflow, whether a URL is in sitemap.xml is its own per-item setting: a noindex meta tag does NOT remove a URL
// from the sitemap. Use this for collections whose item pages exist but are not meant to be indexed. Run it again
// after adding items to those collections, then publish the site (the sitemap only changes on a full publish).
// Saving a page's settings in the Designer can switch the setting back on, so run this after such saves.
//
// Usage:    node sitemap-exclude.mjs [--dry] [--config site.config.json]      --dry lists what would change, changes nothing
// Inputs:   WEBFLOW_TOKEN (environment)
//           <verifyDir>/staging-paths.json           from staging-paths.mjs
//           webflow.sitemapExcludeCollections        collection slugs (the first part of the item URL), e.g. ["tag", "author"]
// Outputs:  changes the sitemap setting of those items in Webflow (not with --dry). Prints a count per collection.
// Exit codes: 0 done; 1 an API call failed; 2 config, token or input missing.
// Network:  the Webflow API only (its beta sitemap endpoints).
import { need, verify, has, readJson } from './site.mjs';
import { request } from './wf-api.mjs';

const DRY = has('--dry');
const EXCLUDE = need('webflow.sitemapExcludeCollections');
const stg = readJson(verify('staging-paths.json'), 'staging-paths.mjs');

const byColl = {};
for (const [path, v] of Object.entries(stg)) {
  const name = path.split('/')[1];
  if (v.kind === 'item' && EXCLUDE.includes(name)) (byColl[v.collection] ||= { name, ids: [] }).ids.push(v.id);
}
for (const [cid, { name, ids }] of Object.entries(byColl)) {
  // read the current setting, change only what differs
  const cur = [];
  for (let off = 0; ; off += 100) {
    const j = await request('GET', `/beta/sitemap/collections/${cid}/items?limit=100&offset=${off}`);
    const list = j.items || j.collectionItems || [];
    cur.push(...list);
    if (list.length < 100) break;
  }
  const on = new Set(cur.filter((x) => x.includeInSitemap !== false).map((x) => x.id));
  const todo = ids.filter((id) => on.has(id) || !cur.find((x) => x.id === id));
  console.log(name.padEnd(20), ids.length, 'items;', todo.length, 'to exclude');
  if (DRY) continue;
  for (let i = 0; i < todo.length; i += 100) {
    await request('PATCH', `/beta/sitemap/collections/${cid}/items`, { items: todo.slice(i, i + 100).map((id) => ({ id, includeInSitemap: false })) });
  }
}
if (!Object.keys(byColl).length) console.log('no items of', EXCLUDE.join(', '), 'in staging-paths.json: nothing to do');
