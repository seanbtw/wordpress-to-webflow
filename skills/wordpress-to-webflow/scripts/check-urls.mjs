// check-urls.mjs — the URL and redirect checker. For every row of a manifest it requests the path on the Webflow
// staging host and follows redirects by hand, recording every hop. A row fails when:
//   - any hop goes to the old WordPress host (the live domain, with or without www, or the local copy);
//   - there is more than ONE real redirect hop (Webflow's own trailing-slash normalisation, /x/ → /x with the query
//     kept, is allowed as an extra hop);
//   - a hop is not a 301;
//   - the final status or destination is not what the manifest expects (path + query on staging; the exact URL when
//     the destination is external, which is not fetched);
//   - the page <title> differs from the manifest's `identity` when one is given, so an unrelated page or a soft 404
//     cannot pass.
//
// Usage:    node check-urls.mjs [--manifest file] [--origin https://host] [--only substring] [--config site.config.json]
//           node check-urls.mjs --fixture      prove the checker first: run it on a manifest that is wrong on purpose
// Inputs:   site.liveOrigin, webflow.stagingOrigin (or --origin), wordpress.localOrigin (optional)
//           <verifyDir>/url-manifest.csv        from build-redirects.py. Columns: source, expected_status (200, 301 or
//                                               404), expected_final, identity, origins (the rest are notes)
//           <verifyDir>/fixture-manifest.csv    with --fixture: a few rows you write for your own site, at least one
//                                               control that is right, one wrong destination, one URL that does not
//                                               exist and one wrong title (see fixtures/fixture-manifest.example.csv)
// Outputs:  <verifyDir>/check-urls.json (full runs only: not with --fixture or --only). Failures are printed.
// Exit codes: 0 every row passed; 1 at least one row failed (with --fixture this is the result you want: every
//           wrong row must be reported and every control must pass); 2 config or manifest missing.
// Network:  the staging origin only. A 429 (rate limit) is waited out and retried, never taken as an answer.
import fs from 'node:fs';
import { origin, verify, arg, has, readCsv, oldHosts, stop } from './site.mjs';

const FIXTURE = has('--fixture');
const ORIGIN = (arg('--origin', null) || origin('webflow.stagingOrigin')).replace(/\/$/, '');
const { live, local } = oldHosts();
const WP_HOSTS = new Set([...live, ...(local ? [local] : [])]);
const FILE = arg('--manifest', verify(FIXTURE ? 'fixture-manifest.csv' : 'url-manifest.csv'));
const only = arg('--only', null);
if (!fs.existsSync(FILE)) stop(`manifest ${FILE} not found` + (FIXTURE ? ' (write a fixture manifest first: see fixtures/fixture-manifest.example.csv)' : ' (run build-redirects.py first, or pass --manifest)'));

const dec = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–').trim();
const same = (a, b) => decodeURIComponent(a.replace(/\+/g, ' ')) === decodeURIComponent(b.replace(/\+/g, ' '));
const rows = readCsv(FILE).filter((r) => !only || r.source.includes(only));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(r) {
  const hops = []; const fails = []; let real = 0;
  let url = ORIGIN + (r.source.startsWith('/') ? r.source : '/' + r.source);
  for (let i = 0; i < 8; i++) {
    let res;
    for (let t = 0; ; t++) {   // Webflow rate-limits bursts (429): wait and retry; a 429 is never an answer
      try { res = await fetch(url, { redirect: 'manual' }); } catch (e) { res = null; fails.push('fetch error ' + e.message); break; }
      if (res.status !== 429 || t > 10) break;
      await res.body?.cancel();
      await sleep(Math.max(+res.headers.get('retry-after') || 0, 5) * 1000 * (1 + t / 2));
    }
    if (!res) break;
    const loc = res.headers.get('location'); const st = res.status;
    if (st >= 300 && st < 400 && loc) {
      const next = new URL(loc, url);
      hops.push({ status: st, from: url.replace(ORIGIN, ''), to: next.host === new URL(ORIGIN).host ? next.pathname + next.search : next.href });
      if (WP_HOSTS.has(next.host)) { fails.push('hop to the WordPress host ' + next.href); break; }
      const cur = new URL(url);
      const slashOnly = cur.pathname.length > 1 && cur.pathname.endsWith('/') && next.host === cur.host && next.pathname === cur.pathname.replace(/\/+$/, '') && next.search === cur.search;
      if (!slashOnly) real++;
      if (st !== 301) fails.push(`hop status ${st} (want 301)`);
      if (next.host !== new URL(ORIGIN).host) { await res.body?.cancel(); return finish(r, hops, real, fails, 301, next.href, ''); }
      url = next.href; await res.body?.cancel(); continue;
    }
    const text = st === 200 && /html/.test(res.headers.get('content-type') || '') ? await res.text() : (await res.body?.cancel(), '');
    const title = dec((text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
    const u = new URL(url);
    return finish(r, hops, real, fails, st, u.pathname + u.search, title);
  }
  return finish(r, hops, real, fails, 'loop', url, '');
}

function finish(r, hops, real, fails, status, final, title) {
  const want = +r.expected_status;
  if (real > 1) fails.push(`${real} redirect hops (want at most 1 + slash normalisation)`);
  if (want === 404) { if (status !== 404) fails.push(`status ${status} at ${final} (want 404)`); }
  else if (want === 301) { if (status !== 301 || !same(final, r.expected_final)) fails.push(`ended ${status} ${final} (want external ${r.expected_final})`); }
  else {
    if (status !== 200) fails.push(`status ${status} at ${final} (want 200 at ${r.expected_final})`);
    else if (!same(final, r.expected_final)) fails.push(`landed on ${final} (want ${r.expected_final})`);
    if (status === 200 && r.identity && dec(r.identity) !== title) fails.push(`title "${title}" (want "${r.identity}")`);
  }
  return { source: r.source, ok: !fails.length, fails, status, final, title, hops, expected: [r.expected_status, r.expected_final], origins: r.origins };
}

const out = []; const queue = [...rows];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) out.push(await check(queue.shift())); }));
const bad = out.filter((x) => !x.ok);
if (!FIXTURE && !only) fs.writeFileSync(verify('check-urls.json'), JSON.stringify(out, null, 1));
for (const b of bad.slice(0, 80)) console.log('FAIL', b.source, '|', b.fails.join('; '), '| hops', b.hops.map((h) => h.status + ' ' + h.to).join(' → '));
console.log(`${ORIGIN}: ${out.length - bad.length} / ${out.length} pass, ${bad.length} fail (${FILE})`);
if (FIXTURE) console.log('fixture run: a FAIL line for every wrong row and none for the control rows means the checker works.');
process.exit(bad.length ? 1 : 0);
