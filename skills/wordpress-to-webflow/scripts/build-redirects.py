#!/usr/bin/env python3
"""build-redirects.py: turns the host's exported redirect rules, the live capture and the config's path rewrites
into (1) a Webflow redirect import CSV, (2) a record of what happened to every rule, and (3) the URL manifest that
check-urls.mjs tests.

Usage:    python3 -I build-redirects.py [--config site.config.json]

Inputs:   site.liveOrigin
          <inventoryDir>/urls.csv             columns path, expected_path, expected_status, note (the WordPress URL inventory)
          <verifyDir>/staging-paths.json      from staging-paths.mjs: every path Webflow serves as a page
          <verifyDir>/live-capture.json       from live-capture.mjs: what live WordPress does today (optional but strongly advised)
          site.redirectRulesFile (optional)   the host's exported rules: a JSON list of { pattern, replacement, argmatch, domain }
                                              (WP Engine's export format); rules run first-match-wins, in file order
          <inventoryDir>/seo.csv (optional)   columns path, title: gives each manifest row the page title to expect
          <inventoryDir>/media-manifest.json (optional)   { "<uploads key>": [{ "destination": "<new URL>" }] }: where each
                                              old media file lives now
          pathRewrites (optional)             [{ exact: [...], to }, { prefixRe, to }] paths that changed on purpose
          redirects.* (all optional)          listingFallbacks, keepQueryOn, targetCorrections, documentsBase, queryCarry,
                                              extra, prefixes, oldSitemaps, identitySkip, testUrls (see site.config.example.json)

Outputs:  <verifyDir>/redirects-import.csv    source,target in run order: import it in Webflow (Site settings, Publishing,
                                              301 redirects, Import). An import REPLACES every existing redirect.
          <inventoryDir>/redirects.csv        every legacy rule and every extra redirect, with what was done and why
          <verifyDir>/url-manifest.csv        one row per old URL: the status and destination to expect on Webflow

Exit codes: 0 built with no problems; 1 built but a check failed (a target that is not a page, or a redirect whose
          target is itself redirected); 2 config or an input file missing.

Webflow's redirect rules, as tested: an old path must escape % - & * ( ) = _ + ? with a % in front; (.*) and %1 are
the wildcard and its capture; matching is case-sensitive; a trailing slash is normalised before matching; the query
string is dropped unless the old path matches it; rules run in the order added. A page at the old path wins, so an
old path that is a page on the new site is not redirected. Every target is a page on the new site (one hop), a page
plus a query, or an external URL, and a target is never itself a redirect source (checked at the end).

The manifest's expectations come from what LIVE WordPress does today (or, for made-up test URLs, from simulating
the host rules), mapped onto the new site. They never come from the Webflow rules built here, so the checker
tests the redirects instead of restating them.

Standard library only. Network: none, unless redirects.documentsBase is set; then each old document URL with no
migrated file is probed with one HEAD request through `curl` (on some Macs Python's urllib fails TLS because it
has no certificate store, so the script shells out to curl instead).
"""
import csv, json, os, re, subprocess, sys
from collections import Counter
from urllib.parse import urlsplit, unquote

sys.dont_write_bytecode = True   # leave no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_config import opt, origin, at, inventory, verify, stop


def load_json(path, made_by=None):
    if not os.path.exists(path): stop(f'{path} not found' + (f' (run {made_by} first)' if made_by else ''))
    with open(path, encoding='utf-8') as f: return json.load(f)


def load_csv(path):
    if not os.path.exists(path): stop(f'{path} not found')
    with open(path, newline='', encoding='utf-8') as f: return list(csv.DictReader(f))


LIVE_HOST = urlsplit(origin('site.liveOrigin')).netloc
LIVE_HOSTS = {LIVE_HOST, LIVE_HOST.removeprefix('www.')}
UPLOADS = opt('wordpress.uploadsPath', '/wp-content/uploads/')

rules_file = opt('site.redirectRulesFile')
rules = load_json(at(rules_file)) if rules_file else []
urls = {r['path']: r for r in load_csv(inventory('urls.csv'))}
stg = load_json(verify('staging-paths.json'), 'staging-paths.mjs')
cap = load_json(verify('live-capture.json')) if os.path.exists(verify('live-capture.json')) else {}
media = load_json(inventory('media-manifest.json')) if os.path.exists(inventory('media-manifest.json')) else {}

REWRITES = opt('pathRewrites', [])
LISTING = [tuple(x) for x in opt('redirects.listingFallbacks', [])]
KEEP_QUERY = set(opt('redirects.keepQueryOn', []))
TYPO = opt('redirects.targetCorrections', {})
DOCS = opt('redirects.documentsBase')
CARRY = {(c['from'].rstrip('/') or '/'): c for c in opt('redirects.queryCarry', [])}
EXTRA = opt('redirects.extra', [])
PREFIXES = opt('redirects.prefixes', [])
OLD_SITEMAPS = opt('redirects.oldSitemaps', [])
IDENTITY_SKIP = set(opt('redirects.identitySkip', []))
TEST_URLS = opt('redirects.testUrls', [])
TEST = 'redirect-test'   # the made-up path part used in generated test URLs

problems = []


def norm(p):
    """the new site's form of a path: no trailing slash (Webflow), query kept"""
    path, _, q = p.partition('?')
    path = path.rstrip('/') or '/'
    return path + ('?' + q if q else '')


def is_page(p): return norm(p).split('?')[0] in stg


def is_url(t): return bool(t) and re.match(r'https?://', t) is not None


def esc(path):
    """escape an old path for Webflow (literal part only)"""
    return re.sub(r'([%\-&*()=_+?])', r'%\1', path)


def live_path(url):
    """path + query of a URL on the live host; None when the URL is on another host"""
    s = urlsplit(url)
    if s.netloc and s.netloc not in LIVE_HOSTS: return None
    return (s.path or '/') + ('?' + s.query if s.query else '')


def rewritten(path):
    """the new path for an old path that the config's pathRewrites move on purpose, else None"""
    bare = path.rstrip('/') or '/'
    for form in (path, bare, bare + '/'):
        for r in REWRITES:
            if form in (r.get('exact') or []) or (r.get('prefixRe') and re.fullmatch(r['prefixRe'], form)): return norm(r['to'])
    return None


# --- where a live WordPress URL lives on the new site (None = nowhere) ----------------------------------------------
def on_staging(livep):
    if livep is None: return None
    path, _, q = livep.partition('?')
    row = urls.get(path) or urls.get(path.rstrip('/') + '/') or urls.get(path.rstrip('/'))
    if row and row.get('expected_status') in ('200', '301') and row.get('expected_path'):
        t = norm(row['expected_path'])
        if is_page(t): return t
    moved = rewritten(path)
    if moved: return moved
    if is_page(path): return norm(path) + ('?' + q if q and norm(path) in KEEP_QUERY else '')
    return None


def listing_for(livep):
    for pre, lst in LISTING:
        if livep and livep.startswith(pre) and is_page(lst): return lst
    return None


# --- simulate the host's rules for a path (first matching rule wins) -------------------------------------------------
compiled = []
for i, r in enumerate(rules):
    try: compiled.append((i, re.compile(r['pattern']), r))
    except re.error: compiled.append((i, None, r))


def host_rule(path, query='', host=LIVE_HOST):
    for i, rx, r in compiled:
        if rx is None or not rx.search(path): continue
        if r.get('argmatch') and r['argmatch'] not in query: continue
        if r.get('domain') and r['domain'] != host: continue
        return i, r['replacement']
    return None, None


def captured(path):
    # the capture keys a path as it was listed (often with the trailing slash)
    return cap.get(path) or cap.get(path.rstrip('/') + '/') or cap.get(path.rstrip('/'))


def live_final(path):
    """the live final destination: from the capture when present, else by simulating the host rules (chained)"""
    c = captured(path)
    # a 403/429/5xx is the live firewall, not an answer
    if c and c['hops'] and c['hops'][-1].get('status') in (200, 404, 410):
        last = c['hops'][-1]
        lp = live_path(last['url'])
        return (lp if lp is not None else last['url']), last['status'], 'capture'
    seen = set(); p = path; q = ''
    for _ in range(6):
        i, tgt = host_rule(p.split('?')[0], q)
        if i is None: return p, None, 'simulated'
        lp = live_path(tgt)
        if lp is None: return tgt, 301, 'simulated'   # external
        if lp in seen: break
        seen.add(lp); p = lp
    return p, None, 'simulated'


# --- old media URLs: <uploads path><key> → where the file lives now ---------------------------------------------------
# WordPress also serves size variants (-300x200, -scaled) of an original: those go to the original's new home.
_probed = {}


def document_exists(u):
    if u not in _probed:
        # curl, not urllib: on some Macs Python has no certificate store and urllib fails TLS
        _probed[u] = subprocess.run(['curl', '-s', '-o', '/dev/null', '-I', '-w', '%{http_code}', u], capture_output=True, text=True).stdout == '200'
    return _probed[u]


def upload_dest(livep):
    if not livep or not livep.startswith(UPLOADS): return None, None
    key = unquote(livep.split('?')[0][len(UPLOADS):])
    if key in media:
        m = media[key]; m = m[0] if isinstance(m, list) else m   # the manifest holds a list of uses, or one
        return m['destination'], 'old media URL → its migrated file'
    base = re.sub(r'-(\d+x\d+|scaled)(?=\.[a-z0-9]+$)', '', key, flags=re.I)
    base = re.sub(r'-(\d+x\d+)(?=\.[a-z0-9]+$)', '', base, flags=re.I)
    if base in media: return media[base][0]['destination'], f'old media URL (size variant of {base}) → the migrated original'
    stem = re.sub(r'\.[a-z0-9]+$', '', base, flags=re.I)
    alt = [k for k in media if re.sub(r'\.[a-z0-9]+$', '', k, flags=re.I) == stem]
    if alt: return media[alt[0]][0]['destination'], f'old media URL ({alt[0]} was migrated under another extension)'
    if DOCS:
        doc = DOCS.rstrip('/') + '/' + key   # documents and video hosted on the media host at the same uploads path
        if document_exists(doc): return doc, 'old document URL → the same file on the media host'
    return None, None


def resolve_target(livep):
    """the new site's target for a live destination path; (target, disposition)"""
    if livep is None: return None, None
    if is_url(livep): return livep, 'external, kept'
    d, why = upload_dest(livep)
    if d: return d, why
    if livep in TYPO: return norm(TYPO[livep]), f'legacy rule target {livep} is a typo (404 on live); corrected to {TYPO[livep]}'
    t = on_staging(livep)
    if t: return t, 'redirect'
    lst = listing_for(livep)
    if lst: return lst, f'target {livep} not on the new site: sent to its listing {lst}'
    return None, None


rows = []   # <inventoryDir>/redirects.csv
imp = []    # (source, target) in order
used = set()


def add(src_old_path, target, **row):
    """src_old_path is the escaped Webflow old path"""
    if src_old_path in used:
        row.update(webflow_from='', webflow_to='', disposition='duplicate: an earlier row already redirects this path')
        rows.append(row); return
    if is_url(target):   # Webflow reads %N in a target as a capture group: write %3A / %2C as : and , (the same URL)
        target = target.replace('%3A', ':').replace('%3a', ':').replace('%2C', ',').replace('%2c', ',')
    used.add(src_old_path); imp.append((src_old_path, target))
    row.update(webflow_from=src_old_path, webflow_to=target); rows.append(row)


def note_domain(base, r):
    if r.get('domain'):
        base['note'] = (base['note'] + '; ' if base['note'] else '') + f'domain-conditional ({r["domain"]}): Webflow serves one host, so unconditional is equivalent'


EXACT = r'\^(/[^()*+?\[\]|{}\\^$]*?)/?(\xa0)?\??\$'
PREFIX = r'\^(/[^()*+?\[\]|{}\\^$]+)'

# 1) exact legacy rules, in the host's order ---------------------------------------------------------------------------
wild = []
for i, r in enumerate(rules):
    n = i + 1; pat = r['pattern']
    base = dict(order='', origin=f'rule#{n}', wp_pattern=pat, wp_argmatch=r.get('argmatch') or '', wp_domain=r.get('domain') or '',
                wp_target=r['replacement'], kind='', disposition='', note='')
    lit = pat.replace('\\/', '/').replace('\\.', '.')
    m = re.fullmatch(EXACT, lit)
    if r.get('argmatch'):
        base['kind'] = 'query-conditional'
        src = lit.strip('^$').replace('//?', '/').replace('/?', '').rstrip('/') or '/'
        lp = live_path(r['replacement'])
        tgt, disp = resolve_target(lp.split('?')[0] if lp else r['replacement'])
        if tgt is None:
            base.update(disposition=f'not added: target {r["replacement"]} has no page on the new site'); rows.append(base); continue
        a, _, b = r['argmatch'].partition('=')
        add(esc(src) + '%?' + esc(a) + ('%=' + esc(b) if b else ''), tgt, **base)
        rows[-1]['disposition'] = 'redirect (query matched in the old path)'; continue
    if m:
        src = m.group(1).rstrip('/') or '/'
        base['kind'] = 'exact'
        if m.group(2): base['note'] = 'pattern also allows a trailing non-breaking space; the plain path is covered'
        if is_page(src):
            base.update(disposition='not added: the old path is a page on the new site (content kept at the same URL)'); rows.append(base); continue
        fin, st, how = live_final(src)
        tgt, disp = resolve_target(fin)
        if tgt is None and st == 404:   # broken on live today: fall back to the rule's own target (typo fix / listing)
            tgt, disp = resolve_target(live_path(r['replacement']))
            if tgt: disp = 'broken on live (target 404s); ' + disp
        if tgt is None:
            base.update(disposition=f'not added: target {r["replacement"]} → live {fin} ({st}) has no page or listing on the new site; the old path 404s'); rows.append(base); continue
        if norm(tgt) == norm(src):
            base.update(disposition='not added: resolves to itself'); rows.append(base); continue
        note_domain(base, r)
        add(esc(src), tgt, **base)
        rows[-1]['disposition'] = disp + (f' (live final via {how})' if fin != live_path(r['replacement']) else '')
        continue
    wild.append((n, r))


# 2) extras: decisions in the config, inventory 301 rows, old sitemaps -------------------------------------------------
def extra(src, tgt, origin_, disp, note=''):
    base = dict(order='', origin=origin_, wp_pattern='', wp_argmatch='', wp_domain='', wp_target='', kind='extra', disposition=disp, note=note)
    add(src, tgt, **base); rows[-1]['disposition'] = disp


# a path whose query must be carried over (for example an old search page): one rule per query parameter, bare path last
for frm, c in CARRY.items():
    for param in c['params']:
        extra(esc(frm) + '%?' + esc(param) + '%=(.*)', norm(c['to']) + '?' + c['toParam'] + '=%1', 'config redirects.queryCarry', 'redirect, query carried')
    extra(esc(frm), norm(c['to']), 'config redirects.queryCarry', 'redirect')
# taxonomy archives and every other inventory row marked 301
for p, r in urls.items():
    if r.get('expected_status') != '301' or (p.rstrip('/') or '/') in CARRY: continue
    src = norm(unquote(p)) if '%20' in p else norm(p)
    tgt = r['expected_path'].replace('/?', '?')
    tgt = norm(tgt.split('?')[0]) + ('?' + tgt.split('?')[1] if '?' in tgt else '')
    moved = rewritten(src)
    if moved:
        extra(esc(src), moved, 'config pathRewrites', 'redirect'); continue
    # Webflow matches the decoded path, and its importer rejects a literal space: the space is matched with (.*)
    old = '(.*)'.join(esc(part) for part in src.split(' '))
    extra(old, tgt, 'inventory 301 (' + (r.get('note') or '')[:60] + ')', 'redirect', 'old path has an encoded space (%20): matched with (.*)' if '%20' in p else '')
# single redirects named in the config (slugs that changed, files that moved to the media host, decisions)
for x in EXTRA:
    if not is_url(x['to']) and not is_page(x['to'].split('?')[0]): problems.append(f'config redirects.extra: target {x["to"]} (from {x["from"]}) is not a page on the new site')
    extra(esc(norm(x['from'])), x['to'], x.get('origin', 'config redirects.extra'), x.get('disposition', 'redirect'), x.get('note', ''))
# whole old sections with no counterpart (for example WordPress archive pagination): prefix rules
for x in PREFIXES:
    extra(esc(x['from']) + '(.*)', x['to'], x.get('origin', 'config redirects.prefixes'), 'redirect', x.get('note', ''))
# the old sitemaps → Webflow's one sitemap
for s in OLD_SITEMAPS:
    extra(esc('/' + s.lstrip('/')), '/sitemap.xml', 'old sitemap', 'redirect')

# 3) every other source the capture covers (inventory, extra lists, live sitemap, Search Console): if it would 404 on
#    the new site but live WordPress lands it on a page that exists there, redirect it there in one hop.
for p, c in sorted(cap.items(), key=lambda kv: -kv[1].get('impressions', 0)):
    path = p.split('?')[0]
    if '?' in p or is_page(path) or on_staging(path): continue
    seen_in = ','.join(c.get('from', [])) + (f", {c['impressions']} impressions" if c.get('impressions') else '')
    if path.startswith(UPLOADS) and esc(path) not in used:
        d, why = upload_dest(path)
        if d: extra(esc(path), d, 'old media URL (' + seen_in + ')', why)
        continue
    if not c['hops'] or not c['hops'][-1].get('status') or len(c['hops']) < 2: continue
    fin = live_path(c['hops'][-1]['url']) or c['hops'][-1]['url']
    if c['hops'][-1]['status'] != 200: continue
    tgt, disp = resolve_target(fin)
    if not tgt or esc(norm(path)) in used: continue
    extra(esc(norm(path)), tgt, 'live redirect (' + seen_in + ')', 'redirect (WordPress-side redirect not in the host rules, reproduced in one hop)')

# 4) wildcard / prefix legacy rules, after every exact rule, in the host's order --------------------------------------
for n, r in wild:
    base = dict(order='', origin=f'rule#{n}', wp_pattern=r['pattern'], wp_argmatch=r.get('argmatch') or '', wp_domain=r.get('domain') or '',
                wp_target=r['replacement'], kind='wildcard', disposition='', note='')
    lit = r['pattern'].replace('\\/', '/').replace('\\.', '.')
    m = re.fullmatch(PREFIX, lit)
    if not m:
        base.update(disposition=f'not added: pattern {r["pattern"]!r} (target {r["replacement"]!r}) is not an anchored path or prefix, so Webflow cannot express it. Check by hand what the live site does with it.'); rows.append(base); continue
    tgt = r['replacement']
    pre = m.group(1)
    first, _ = host_rule(pre)
    if first is not None and first != n - 1:   # an earlier host rule matches this prefix first: this rule never fires on live
        base.update(disposition=f'not added: unreachable on the host (rule#{first + 1} {rules[first]["pattern"]} matches first); live follows rule#{first + 1}'); rows.append(base); continue
    c = cap.get(pre) or cap.get(pre + '/')
    if c and c['hops'] and c['hops'][0].get('status') == 301 and live_path(c['hops'][0]['location']) is None and c['hops'][0]['location'] != tgt:
        base['note'] = f'live target differs from the exported rule ({tgt}); live used'; tgt = c['hops'][0]['location']
    note_domain(base, r)
    if not is_url(tgt):
        t2, d2 = resolve_target(live_path(tgt))
        if not t2: base.update(disposition=f'not added: target {tgt} has no page on the new site'); rows.append(base); continue
        tgt = t2
    add(esc(pre) + '(.*)', tgt, **base)
    rows[-1]['disposition'] = 'prefix rule → ' + ('external, kept' if tgt.startswith('http') else 'redirect')


# --- checks: one hop, targets exist -----------------------------------------------------------------------------------
def matches(old, path):
    rx = '^' + re.sub(r'%(.)', lambda m: re.escape(m.group(1)), old.replace('(.*)', '\x00')).replace('\x00', '(.*)') + '$'
    return re.match(rx, path)


for s, t in imp:
    if t.startswith('http'): continue
    tp = t.split('?')[0]
    if not is_page(tp) and tp != '/sitemap.xml': problems.append(f'target not a page: {s} -> {t}')
    for s2, _ in imp:
        if matches(s2, tp): problems.append(f'chain: {s} -> {t} is itself redirected by {s2}')
order_of = {s: k + 1 for k, (s, _) in enumerate(imp)}
for r in rows: r['order'] = str(order_of.get(r['webflow_from'], '')) if r.get('webflow_from') else ''

cols = ['order', 'webflow_from', 'webflow_to', 'kind', 'origin', 'disposition', 'note', 'wp_pattern', 'wp_argmatch', 'wp_domain', 'wp_target']
with open(inventory('redirects.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, cols); w.writeheader()
    for r in rows: w.writerow({k: r.get(k, '') for k in cols})
with open(verify('redirects-import.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f); w.writerow(['source', 'target']); w.writerows(imp)
print(len(imp), 'redirects to import;', len(rows), 'rows;', Counter(r['disposition'].split(':')[0].split(' (')[0] for r in rows).most_common())
print('legacy rules with an outcome:', len({r['origin'] for r in rows if r['origin'].startswith('rule#')}), '/', len(rules))

# ======================================================================================================================
# URL manifest (<verifyDir>/url-manifest.csv)
seo = {}
if os.path.exists(inventory('seo.csv')):
    for r in load_csv(inventory('seo.csv')): seo.setdefault(norm(r['path']), r['title'])
else:
    print('note: no seo.csv in the inventory folder, so manifest rows carry no page title to check')


def identity(path):
    p = path.split('?')[0]
    return '' if p in IDENTITY_SKIP else seo.get(p, '')


EXTRA_EXPECT = {norm(unquote(p)): r for p, r in urls.items() if r.get('expected_status') == '301'}
EXTRA_MAP = {norm(x['from']): x for x in EXTRA}
FALLBACK = {r['webflow_from']: (r['webflow_to'], r['disposition']) for r in rows
            if r.get('webflow_from') and any(w in r['disposition'] for w in ('broken on live', 'not on the new site', 'is a typo'))}
man = []


def joined(a, b): return (a + '; ' if a else '') + b


def expect(src, origins, impressions=0, note=''):
    path, _, q = src.partition('?')
    np = norm(path)
    row = dict(source=src, origins=origins, impressions=impressions, live_status='', live_final='', expected_status='', expected_final='', identity='', note=note)
    c = cap.get(src)
    if c and c['hops'] and c['hops'][-1].get('status') in (200, 404, 410):
        row['live_status'] = c['hops'][-1]['status']; row['live_final'] = c['hops'][-1]['url']
    elif c and c['hops']: note = joined(note, f"live answered {c['hops'][-1].get('status')} (firewall); expectation from the host rules")
    # decisions first
    if np in CARRY:
        cy = CARRY[np]
        parts = [x for x in q.split('&') if x]
        key = next((x for x in parts if x.split('=')[0] in cy['params']), None)   # the first matching parameter is carried; the rest is kept
        rest = [x for x in parts if x is not key]
        qs = ([cy['toParam'] + '=' + (key.split('=', 1)[1] if '=' in key else '')] if key else []) + rest
        row.update(expected_status=200, expected_final=norm(cy['to']) + ('?' + '&'.join(qs) if qs else ''), note='query carried (config redirects.queryCarry)'); man.append(row); return
    if np in EXTRA_EXPECT and not is_page(np):
        r = EXTRA_EXPECT[np]; t = r['expected_path'].replace('/?', '?'); t = norm(t.split('?')[0]) + ('?' + t.split('?')[1] if '?' in t else '')
        row.update(expected_status=200, expected_final=t, identity=identity(t), note=r.get('note') or ''); man.append(row); return
    if np in EXTRA_MAP and not is_page(np):
        x = EXTRA_MAP[np]
        row.update(expected_status=301 if is_url(x['to']) else 200, expected_final=x['to'], note=x.get('origin', 'config redirects.extra')); man.append(row); return
    if re.fullmatch(r'/[a-z_-]*sitemap[a-z_-]*\.xml', np) and np != '/sitemap.xml':
        row.update(expected_status=200, expected_final='/sitemap.xml', note='old sitemap'); man.append(row); return
    if np.startswith(UPLOADS):
        d, why = upload_dest(np)
        if d: row.update(expected_status=301, expected_final=d, note=why); man.append(row); return
        note = joined(note, 'old media URL with no migrated file of its own')   # a legacy rule may still send it on: fall through
    if is_page(np):
        row.update(expected_status=200, expected_final=np + ('?' + q if q else ''), identity=identity(np))
        if row['live_status'] and row['live_status'] != 200: row['note'] = joined(note, f'live answers {row["live_status"]} ({row["live_final"]}); the page exists on Webflow')
        man.append(row); return
    # a legacy rule whose live target is broken now lands on its recorded fallback
    fb = FALLBACK.get(esc(np))
    if fb:
        t, why = fb
        row.update(expected_status=301 if t.startswith('http') else 200, expected_final=t, identity='' if t.startswith('http') else identity(t), note=joined(row['note'], why)); man.append(row); return
    # live behaviour
    if row['live_status']:
        fin = live_path(row['live_final']); st = row['live_status']
    else:
        fin, st, _ = live_final(src); row['note'] = joined(note, 'expected from the host rules (not captured live)')
        if st is None: st = 200 if fin and (is_page(fin) or upload_dest(fin)[0]) else 404
    if fin is None or (row['live_final'] and live_path(row['live_final']) is None) or is_url(fin):
        ext = row['live_final'] if row['live_final'] and live_path(row['live_final']) is None else fin
        if ext and ext.startswith('http'):
            row.update(expected_status=301, expected_final=ext); man.append(row); return
    if st == 200:
        t, disp = resolve_target(fin)
        if t and t.startswith('http'):
            row.update(expected_status=301, expected_final=t, note=joined(row['note'], disp or '')); man.append(row); return
        if t:
            row.update(expected_status=200, expected_final=t, identity=identity(t))
            if disp and disp != 'redirect': row['note'] = joined(row['note'], disp)
            man.append(row); return
        row.update(expected_status=404, expected_final='', note=joined(row['note'], f'live page {fin} has no counterpart on the new site (not migrated)')); man.append(row); return
    row.update(expected_status=404, expected_final=''); man.append(row)


for p, c in cap.items(): expect(p, ','.join(c.get('from', [])), c.get('impressions', 0))
seen = {m['source'] for m in man}
# both slash forms of every exact legacy rule source; positive + negative cases for every prefix rule
for r in rows:
    if not r['origin'].startswith('rule#'): continue
    lit = r['wp_pattern'].replace('\\/', '/').replace('\\.', '.')
    m = re.fullmatch(EXACT, lit)
    if m and not r['wp_argmatch']:
        forms = {m.group(1).rstrip('/') or '/'}
        if re.search(r'(\\?/)\?\$$', r['wp_pattern']) or r['wp_pattern'].endswith('/$'): forms.add((m.group(1).rstrip('/') or '') + '/')   # only patterns that allow the slash
        for v in sorted(forms):
            if v not in seen: seen.add(v); expect(v, r['origin'])
    m = re.fullmatch(PREFIX, lit)
    if m and r['kind'] == 'wildcard':
        pre = m.group(1)
        for v, kind in [(pre, 'positive'), (pre + '/' + TEST, 'positive'), (pre + '-' + TEST, 'positive'), (pre[:-1] + '~', 'negative')]:
            if v not in seen:
                seen.add(v); expect(v, r['origin'] + ' ' + kind)
                if kind == 'positive' and 'live target differs' in r['note'] and man[-1]['expected_status'] == 301:   # live is the reference, not the export
                    man[-1].update(expected_final=r['webflow_to'], note=joined(man[-1]['note'], 'live target (the exported rule is stale)'))
# test cases: the config's own, both forms of every carried-query path, and two URLs that never existed
tests = list(TEST_URLS)
for frm in CARRY: tests += [frm, frm + '/']
tests += ['/' + TEST + '-never-existed'] + [pre + TEST + '-never-existed' for pre, _ in LISTING]
for v in tests:
    if v not in seen: seen.add(v); expect(v, 'test case')
mcols = ['source', 'expected_status', 'expected_final', 'identity', 'origins', 'impressions', 'live_status', 'live_final', 'note']
with open(verify('url-manifest.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, mcols); w.writeheader()
    for m in man: w.writerow({k: m.get(k, '') for k in mcols})
print('manifest rows:', len(man), Counter(str(m['expected_status']) for m in man))
for p in problems[:30]: print('PROBLEM', p)

sys.exit(1 if problems else 0)
