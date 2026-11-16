// console-check.mjs — browser console errors, in two modes.
//
// 1. Staging check (default). Loads every static page, one item of every collection, any extra paths and a path
//    that does not exist (with --all: every page and every item in staging-paths.json), at each width, in headless Chromium, scrolls to the bottom and collects console errors and
//    page errors. It also reads each page's HTML and lists the external stylesheets and scripts: when the config
//    names a release bundle there must be exactly one stylesheet and one script of it, and every other external file
//    must be a declared dependency (Webflow's own files, plus the hosts the config declares). Errors raised by
//    another origin's script or frame are kept apart as third-party notes and do not fail the page.
// 2. Compare (--compare <originA> <originB>). Loads the same paths on two origins at 1440 and 390 wide and compares
//    what the page looked like to scripts (title, language, text length, counts of the selectors the config names)
//    and what the console said. Use it to show a change did nothing visible: the untouched site first, the changed
//    site second. Console lines already present on the first origin are not reported.
//
// Usage:    node console-check.mjs [--all] [--config site.config.json]
//           Trackers are left to run, so the console is the one a visitor's browser shows; form posts are never sent.
//           node console-check.mjs --compare https://www.example.com https://example.webflow.io
// Inputs:   webflow.stagingOrigin
//           <verifyDir>/staging-paths.json (mode 1, unless checks.console.paths is set)
//           checks.console.paths (optional)            the exact list of paths to load instead of the default set
//           checks.console.extraPaths (optional)       more paths for the default set (for example a search results URL)
//           checks.console.notFoundPath (optional)     default /this-page-does-not-exist
//           checks.console.widths (optional)           default [390, 768, 992, 1440]
//           checks.console.declaredHosts (optional)    regular expressions for third-party files the site is meant to load
//           checks.console.thirdPartyRes (optional)    regular expressions for console text that is a third party's
//                                                      own complaint (for example a maps key refused on the staging host)
//           checks.console.comparePaths                mode 2: the paths to load on both origins
//           checks.console.probeSelectors (optional)   mode 2: { name: "css selector" } elements to count on each origin
//           release.assetsOrigin + release.bundleName (optional)   where the site's own script and stylesheet are served
// Outputs:  <verifyDir>/console-check.json (mode 1) or <verifyDir>/console-compare.json (mode 2)
// Exit codes: 0 clean (mode 1) or no differences (mode 2); 1 otherwise; 2 config or input missing.
// Network:  the staging origin (mode 1) or the two origins given (mode 2), plus whatever those pages load.
// Needs:    playwright (npm install, then npx playwright install chromium).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { need, opt, origin, optOrigin, verify, has, positionals, readJson } from './site.mjs';
import { guardPosts } from './block.mjs';

const rx = (s) => new RegExp(s);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const THIRD = opt('checks.console.thirdPartyRes', []).map(rx);

if (has('--compare')) await compare(); else await staging();

async function staging() {
  const WF = origin('webflow.stagingOrigin');
  const NOT_FOUND = opt('checks.console.notFoundPath', '/this-page-does-not-exist');
  let paths = opt('checks.console.paths', null);
  if (!paths) {
    const stg = readJson(verify('staging-paths.json'), 'staging-paths.mjs');
    paths = Object.keys(stg).filter((p) => has('--all') || stg[p].kind === 'page');
    const firstOf = {};   // one item per collection, unless --all has taken every item already
    if (!has('--all')) for (const [p, v] of Object.entries(stg)) if (v.kind === 'item' && !firstOf[v.collection]) firstOf[v.collection] = p;
    paths.push(...Object.values(firstOf), ...opt('checks.console.extraPaths', []), NOT_FOUND);
  }
  const WIDTHS = opt('checks.console.widths', [390, 768, 992, 1440]);
  const assets = optOrigin('release.assetsOrigin'); const bundle = opt('release.bundleName', null);
  // our own files: <assets host>/<build hash>/<bundle name>.css and .min.js
  const OURS = assets && bundle ? new RegExp(reEsc(new URL(assets).host) + '\\/[0-9a-f]+\\/' + reEsc(bundle) + '\\.(css|min\\.js)') : null;
  const ours = (u) => !!OURS && OURS.test(u);
  const DECLARED = [/website-files\.com|webflow\.com|d3e54v103j8qbb\.cloudfront\.net/, /jquery/, ...opt('checks.console.declaredHosts', []).map(rx)];

  const out = {};
  // the served HTML: one fetch per page
  for (const path of paths) {
    const html = await (await fetch(WF + path)).text();
    const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const js = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    out[path] = { oursCss: css.filter(ours).length, oursJs: js.filter(ours).length, undeclared: [...css, ...js].filter((u) => !ours(u) && !DECLARED.some((r) => r.test(u))), errors: {} };
  }
  const browser = await chromium.launch();
  const ownHost = new URL(WF).host;
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    await guardPosts(ctx);
    for (const path of paths) {
      const page = await ctx.newPage(); const errs = []; const third = [];
      // third party: anything raised inside another origin's frame or script, or text the config names. Kept apart as notes.
      const isThird = (u, text) => (u && !u.startsWith('data:') && new URL(u, WF).host !== ownHost && !ours(u)) || THIRD.some((r) => r.test(text));
      page.on('pageerror', (e) => (THIRD.some((r) => r.test(e.stack || '')) ? third : errs).push('pageerror: ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const u = m.location()?.url || '';
        (isThird(u, m.text()) ? third : errs).push('console: ' + m.text() + (u ? ' @' + u.slice(0, 80) : ''));
      });
      try {
        await page.goto(WF + path, { waitUntil: 'load', timeout: 60000 });
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
        await page.waitForTimeout(2500);
      } catch (e) { errs.push('load: ' + e.message.split('\n')[0]); }
      // the not-found page's own "Failed to load resource: 404" is expected
      out[path].errors[w] = errs.filter((e) => !(path === NOT_FOUND && /status of 404/.test(e)));
      (out[path].thirdParty ||= {})[w] = [...new Set(third)];
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  let bad = 0;
  for (const [path, r] of Object.entries(out)) {
    const errs = Object.entries(r.errors).filter(([, e]) => e.length);
    const ok = (!OURS || (r.oursCss === 1 && r.oursJs === 1)) && !r.undeclared.length && !errs.length;
    if (!ok) bad++;
    console.log(ok ? 'OK ' : 'BAD', path.padEnd(44), OURS ? `css ${r.oursCss} js ${r.oursJs}` : '', r.undeclared.length ? 'undeclared ' + r.undeclared.join(' ') : '',
      errs.map(([w, e]) => `${w}: ${[...new Set(e)].slice(0, 2).join(' / ').slice(0, 220)}`).join(' | '));
  }
  fs.writeFileSync(verify('console-check.json'), JSON.stringify(out, null, 1));
  console.log(Object.keys(out).length - bad, '/', Object.keys(out).length, 'pages clean at', WIDTHS.join('/'));
  process.exit(bad ? 1 : 0);
}

async function compare() {
  const origins = positionals().map((o) => o.replace(/\/$/, ''));
  if (origins.length !== 2) { console.error('console-check --compare needs two origins: the untouched site first, the changed site second'); process.exit(2); }
  const PATHS = need('checks.console.comparePaths');
  const selectors = opt('checks.console.probeSelectors', {});
  const probe = (sel) => ({
    url: location.pathname,
    title: document.title,
    lang: document.documentElement.lang,
    main: !!document.querySelector('main'),
    bodyText: document.body.innerText.length,
    ...Object.fromEntries(Object.entries(sel).map(([name, s]) => [name, document.querySelectorAll(s).length])),
    jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
      try { const j = JSON.parse(s.textContent); return [].concat(j['@graph'] || j).map((n) => n['@type']).join('+'); } catch { return 'INVALID'; }
    }),
  });
  const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
  const browser = await chromium.launch();
  const out = {};
  for (const o of origins) for (const path of PATHS) for (const vp of VIEWPORTS) {
    const cx = await browser.newContext({ viewport: vp }); await guardPosts(cx);   // never post a form, on either origin
    const page = await cx.newPage();
    const log = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
    page.on('pageerror', (e) => log.push('pageerror: ' + String(e.message).slice(0, 300)));
    page.on('requestfailed', (r) => log.push('requestfailed: ' + r.url().slice(0, 200) + ' ' + (r.failure() || {}).errorText));
    await page.goto(o + path, { waitUntil: 'load', timeout: 60000 });
    await page.mouse.wheel(0, 1600); await page.waitForTimeout(2500);
    out[`${o}${path} @${vp.width}`] = { ...(await page.evaluate(probe, selectors)), console: log };
    await cx.close();
  }
  await browser.close();
  fs.writeFileSync(verify('console-compare.json'), JSON.stringify(out, null, 2) + '\n');
  // Compare: the same probe values (except jsonld) and the same console lines (origins and host names normalised) on each origin.
  const hosts = origins.map((o) => new URL(o).host);
  const strip = (s) => hosts.reduce((a, h) => a.split(h).join('<host>'), origins.reduce((a, o) => a.split(o).join('<origin>'), s))
    // headless Chromium's own GPU notes carry a per-run context address and a 'no longer repeat' suffix
    .replace(/WebGL-0x[0-9a-f]+/g, 'WebGL-<ctx>').replace(/ \(this message will no longer repeat\)/, '');
  let diff = 0;
  for (const path of PATHS) for (const { width: w } of VIEWPORTS) {
    const [a, b] = origins.map((o) => out[`${o}${path} @${w}`]);
    for (const k of Object.keys(a)) {
      if (k === 'url' || k === 'jsonld' || k === 'console') continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { diff++; console.log(`DIFF ${path} @${w} ${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`); }
    }
    const before = new Set(a.console.map(strip)); const added = b.console.map(strip).filter((l) => !before.has(l));
    if (added.length) { diff++; console.log(`NEW console lines ${path} @${w}:\n  ` + added.join('\n  ')); }
    console.log(`${path} @${w}: before jsonld=${JSON.stringify(a.jsonld)} after jsonld=${JSON.stringify(b.jsonld)} console before=${a.console.length} after=${b.console.length}`);
  }
  console.log(diff ? `${diff} difference(s)` : 'no differences in script behaviour or console between the two origins');
  process.exit(diff ? 1 : 0);
}
