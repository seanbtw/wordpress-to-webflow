// cms-counts.mjs — checks the Webflow CMS against what the import was meant to produce. Run it after the import and
// after anything that may touch the CMS (for example restoring a site backup). Per collection it compares Webflow's
// total / published / draft item counts with the expected numbers, and, when the expected file lists items, every
// item's name and slug.
//
// Usage:    node cms-counts.mjs [--config site.config.json]
// Inputs:   WEBFLOW_TOKEN (environment)
//           webflow.collections                    { "<collection key>": "<collection id>" }
//           <inventoryDir>/cms-expected.json       { "<collection key>": { "publish": 12, "draft": 1,
//                                                    "items": [{ "slug": "…", "name": "…" }] } }
//                                                  `items` is optional: without it only the counts are compared
// Outputs:  <verifyDir>/cms-counts-<date and time>.json and one line per collection
// Exit codes: 0 every collection matches; 1 at least one mismatch (or an API call failed); 2 config, token or the
//           expected file missing.
// Network:  the Webflow API only (read-only calls).
import fs from 'node:fs';
import { need, inventory, verify, readJson } from './site.mjs';
import { all } from './wf-api.mjs';

const collections = need('webflow.collections');
const expected = readJson(inventory('cms-expected.json'));
const res = {}; let bad = 0;
for (const [key, id] of Object.entries(collections)) {
  const items = await all(id);
  const live = await all(id, { live: true }).catch(() => []);
  const draft = items.filter((x) => x.isDraft).length;
  const e = expected[key] || {};
  const byKey = new Map(items.map((x) => [x.fieldData.slug, x.fieldData.name]));
  const nameSlugMismatch = (e.items || []).filter((w) => byKey.get(w.slug) !== w.name).map((w) => w.slug);
  const ok = items.length === (e.publish + e.draft) && live.length === e.publish && draft === e.draft && !nameSlugMismatch.length;
  if (!ok) bad++;
  res[key] = { total: items.length, live: live.length, draft, expected: { publish: e.publish, draft: e.draft }, nameSlugMismatch: nameSlugMismatch.slice(0, 5), ok };
  console.log(key.padEnd(20), items.length, live.length, draft, ok ? 'ok' : 'MISMATCH ' + JSON.stringify({ publish: e.publish, draft: e.draft }) + ' ' + nameSlugMismatch.slice(0, 3));
}
const out = verify(`cms-counts-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`);
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log('collections', Object.keys(res).length, 'items', Object.values(res).reduce((a, r) => a + r.total, 0), 'mismatches', bad, '→', out);
process.exit(bad ? 1 : 0);
