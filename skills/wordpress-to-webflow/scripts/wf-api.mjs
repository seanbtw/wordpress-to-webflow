// wf-api.mjs — a small helper for the Webflow Data API, used by the scripts that read or change the Webflow site.
//
// Usage:    import { api, request, all } from './wf-api.mjs';
//             await api('GET', '/sites/<site id>/pages')            → the v2 API
//             await request('GET', '/beta/sitemap/...')             → any other API path, used as given
//             await all('<collection id>')                          → every item of a collection (all pages of results)
// Inputs:   the WEBFLOW_TOKEN environment variable (a Webflow site token). It is read from the environment only:
//           never from a file, never from the config, and it is never printed or written anywhere.
// Outputs:  nothing on disk.
// Exit codes: 2 when WEBFLOW_TOKEN is not set. A failed API call throws (the message has the method, path, status
//           and the start of Webflow's answer; never the token).
// Webflow answers 429 when calls come too fast: the helper waits and tries again, up to 8 times.
import { config, ROOT } from './site.mjs';

const token = (process.env.WEBFLOW_TOKEN || '').trim();
if (!token) {
  console.error('wf-api: the WEBFLOW_TOKEN environment variable is not set. Export it in your shell for this run; do not put it in a file the kit reads.');
  process.exit(2);
}

const HOST = 'https://api.webflow.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One API call. `path` is used as given (for example '/v2/sites/…' or '/beta/sitemap/…'). */
export async function request(method, path, body) {
  for (let i = 0; ; i++) {
    const r = await fetch(HOST + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (r.status === 429 && i < 8) { await sleep(3000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${(await r.text()).slice(0, 400)}`);
    return r.status === 204 ? {} : r.json();
  }
}

/** One call to the v2 Data API: api('GET', '/collections/<id>'). */
export const api = (method, path, body) => request(method, '/v2' + path, body);

/** Every item of a collection (staged items: drafts included). Pass { live: true } for published items only. */
export async function all(collectionId, { live = false } = {}) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const d = await api('GET', `/collections/${collectionId}/items${live ? '/live' : ''}?limit=100&offset=${offset}`);
    out.push(...d.items);
    if (out.length >= d.pagination.total || !d.items.length) break;
  }
  return out;
}

export { config, ROOT };
