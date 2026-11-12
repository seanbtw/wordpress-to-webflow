#!/usr/bin/env python3
"""code-parity.py: lists every piece of code in the <head> and <body> of the live WordPress pages and of their
Webflow counterparts, one page per template, so nothing the old site printed is lost without a decision.
Per page and per side it lists: scripts (external by host + path; inline by purpose), links by rel, metas,
noscript content, iframes, JSON-LD types, and the <html> / <body> attributes.

Usage:    python3 -I code-parity.py [--config site.config.json]
          then python3 -I code-parity-report.py for the side-by-side table with a verdict per item.

Inputs:   <verifyDir>/code-parity/pages.tsv         one line per template: slug <TAB> live path <TAB> Webflow path
          <verifyDir>/code-parity/raw/live-<slug>.html and raw/wf-<slug>.html
                                                    the served HTML of each page, saved by you beforehand, for example
                                                    curl -sL "<live origin><live path>" -o raw/live-<slug>.html
          site.liveOrigin, webflow.stagingOrigin, wordpress.localOrigin (optional): their hosts are written as SELF
                                                    so the two sides compare
          release.assetsOrigin + release.bundleName (optional): the site's own bundle, labelled "site bundle"
          checks.codeParity.purposes (optional)     [["name", "regular expression"], ...] more labels for inline
                                                    scripts (your form, chat or tracking vendors)
Outputs:  <verifyDir>/code-parity/inventory.json    and a summary of script sources and inline purposes per side
Exit codes: 0 written; 2 config or an input file missing.
Standard library only. Network: none (this script reads saved files; it fetches nothing).
"""
import html, json, os, re, sys
from html.parser import HTMLParser
from urllib.parse import urlparse

sys.dont_write_bytecode = True   # leave no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_config import opt, origin, verify, stop

D = os.path.dirname(verify('code-parity', 'inventory.json'))
PURPOSE = [('GTM', r'googletagmanager|GTM-'), ('Clarity', r'clarity\.ms'), ('GA', r'gtag\(|google-analytics|googletagmanager\.com/gtag'),
           ('Maps', r'maps\.googleapis|google\.maps'), ('CF7', r'wpcf7'), ('Yoast', r'yoast'), ('Alpine', r'alpine|x-data'),
           ('WP core', r'wp-emoji|wpemoji|wp\.i18n|wp-includes|_wpemojiSettings|wp\.hooks'), ('NitroPack', r'nitro'), ('Webflow', r'webflow|Webflow'),
           ('jQuery', r'jquery'), ('Vimeo', r'vimeo'), ('Swiper/Flickity', r'swiper|flickity'), ('reCAPTCHA', r'recaptcha'), ('Hotjar', r'hotjar'),
           ('LinkedIn Insight', r'snap\.licdn|_linkedin_partner'), ('Meta Pixel', r'fbevents|fbq\('), ('image preload', r"loading','eager'|fetchpriority")]
_assets = opt('release.assetsOrigin'); _bundle = opt('release.bundleName')
if _assets and _bundle: PURPOSE.append(('site bundle', re.escape(urlparse(_assets).netloc) + '|' + re.escape(_bundle) + r'\.min'))
PURPOSE += [tuple(p) for p in opt('checks.codeParity.purposes', [])]

_live = urlparse(origin('site.liveOrigin')).netloc.removeprefix('www.')
SELF_HOSTS = {_live, 'www.' + _live, urlparse(origin('webflow.stagingOrigin')).netloc}
if opt('wordpress.localOrigin'): SELF_HOSTS.add(urlparse(opt('wordpress.localOrigin')).netloc)


def purpose(text):
    hits = [n for n, rx in PURPOSE if re.search(rx, text, re.I)]
    return hits or ['other: ' + re.sub(r'\s+', ' ', text.strip())[:60]]


def norm(u):
    if not u: return ''
    u = html.unescape(u); p = urlparse(u if '//' in u else 'https://SELF' + (u if u.startswith('/') else '/' + u))
    host = 'SELF' if p.netloc in SELF_HOSTS else p.netloc
    return host + re.sub(r'/\d+[a-f0-9]{4,}/', '/<hash>/', p.path)


class Page(HTMLParser):
    def __init__(s):
        super().__init__(); s.r = {'html': {}, 'body': {}, 'scripts': [], 'links': [], 'metas': [], 'noscript': [], 'iframes': [], 'jsonld': []}
        s.cur = None; s.buf = ''; s.attrs = {}

    def handle_starttag(s, t, a):
        a = dict(a)
        if t == 'html': s.r['html'] = {k: v for k, v in a.items() if k in ('lang', 'dir', 'class') or k.startswith('data-')}
        if t == 'body': s.r['body'] = {'class': (a.get('class') or '')[:200], **{k: v for k, v in a.items() if k.startswith('data-') or k in ('id',)}}
        if t == 'script': s.cur = 'script'; s.buf = ''; s.attrs = a
        if t == 'noscript': s.cur = 'noscript'; s.buf = ''
        if t == 'link': s.r['links'].append({'rel': (a.get('rel') or '').lower(), 'href': norm(a.get('href')), 'type': a.get('type', ''), 'as': a.get('as', ''), 'title': a.get('title', '')})
        if t == 'meta':
            k = a.get('name') or a.get('property') or a.get('http-equiv') or ('charset' if 'charset' in a else '')
            if k: s.r['metas'].append({'key': k.lower(), 'content': (a.get('content') or a.get('charset') or '')[:120]})
        if t == 'iframe': s.r['iframes'].append(norm(a.get('src') or a.get('data-src')))
        if s.cur == 'noscript' and t in ('img', 'iframe'): s.r['noscript'].append(t + ':' + norm(a.get('src')))

    def handle_endtag(s, t):
        if t == 'script' and s.cur == 'script':
            a = s.attrs; typ = (a.get('type') or '').lower()
            if 'ld+json' in typ:
                try:
                    j = json.loads(s.buf); items = j.get('@graph', [j]) if isinstance(j, dict) else j
                    s.r['jsonld'] += [i.get('@type') if isinstance(i.get('@type'), str) else '/'.join(i.get('@type', [])) for i in items if isinstance(i, dict)]
                except Exception: s.r['jsonld'].append('UNPARSABLE')
            elif a.get('src'): s.r['scripts'].append({'src': norm(a['src']), 'id': a.get('id', ''), 'async': 'async' in a, 'defer': 'defer' in a, 'type': typ})
            elif s.buf.strip(): s.r['scripts'].append({'inline': purpose(s.buf), 'id': a.get('id', ''), 'type': typ, 'len': len(s.buf)})
            s.cur = None
        if t == 'noscript' and s.cur == 'noscript': s.cur = None

    def handle_data(s, d):
        if s.cur in ('script',): s.buf += d


pages = os.path.join(D, 'pages.tsv')
if not os.path.exists(pages): stop(f'{pages} not found (one line per template: slug <TAB> live path <TAB> Webflow path)')
out = {}
with open(pages, encoding='utf-8') as f: lines = [l.rstrip('\n') for l in f if l.strip()]
for line in lines:
    slug, lp, wp = line.split('\t')
    out[slug] = {'paths': [lp, wp]}
    for side in ('live', 'wf'):
        raw = os.path.join(D, 'raw', f'{side}-{slug}.html')
        if not os.path.exists(raw): stop(f'{raw} not found (save the served HTML of that page there first)')
        p = Page()
        with open(raw, encoding='utf-8', errors='replace') as f: p.feed(f.read())
        out[slug][side] = p.r
with open(os.path.join(D, 'inventory.json'), 'w', encoding='utf-8') as f: json.dump(out, f, indent=1)
# quick summary: unique script sources / inline purposes per side over all pages
for side in ('live', 'wf'):
    srcs = sorted({s['src'] for v in out.values() for s in v[side]['scripts'] if 'src' in s})
    inl = sorted({x for v in out.values() for s in v[side]['scripts'] if 'inline' in s for x in s['inline']})
    print(f'== {side}: {len(srcs)} script srcs')
    for x in srcs: print('  ', x)
    print('   inline purposes:')
    for x in inl: print('  ', x)
