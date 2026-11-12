#!/usr/bin/env python3
"""diff-staging-live.py: compares the Webflow staging copy of a site with the live site, page by page, to prove
that a publish will ship nothing unexpected. Use it on a site that is already live on Webflow: before publishing
a change made on staging (for example new schema markup), every difference between staging and live should be
that change and nothing else.

Webflow's compiled names differ between the two hosts (the CSS file hash, data-wf-domain, the "Last Published"
comment, integrity hashes), so those are normalised first. JSON-LD blocks are counted separately; with
--ignore-jsonld they are removed before comparing, so only stray changes show. On the home page the site CSS and
any script whose file name differs are also fetched and compared by content.

Usage:    python3 -I diff-staging-live.py [--ignore-jsonld] [--config site.config.json]
Inputs:   site.liveOrigin, webflow.stagingOrigin; the live site's /sitemap.xml gives the page list (plus /404, /401)
Outputs:  one line per page (status on each side, JSON-LD block counts, changed lines), the first 40 changed lines
          of any page that differs, and a total. Nothing on disk.
Exit codes: 0 no differences (apart from JSON-LD when --ignore-jsonld is given); 1 other differences; 2 config missing.
Standard library only. Network: the live and staging origins, through `curl` (on some Macs Python's urllib fails
TLS because it has no certificate store, so the script shells out to curl instead). Needs curl on the PATH.
"""
import difflib, os, re, subprocess, sys

sys.dont_write_bytecode = True   # leave no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_config import origin, has

LIVE = origin('site.liveOrigin')
STAGING = origin('webflow.stagingOrigin')
LIVE_HOST = LIVE.split('://', 1)[1]
STAGING_HOST = STAGING.split('://', 1)[1]
SITE_NAME = re.escape(STAGING_HOST.split('.')[0])   # Webflow names the site CSS <site short name>.webflow.shared.<hash>.css
IGNORE_LD = has('--ignore-jsonld')


def get(url):
    # curl, not urllib: on some Macs Python has no certificate store (CERTIFICATE_VERIFY_FAILED)
    out = subprocess.run(['curl', '-sSL', '--max-time', '30', '-A', 'Mozilla/5.0 (staging-live check)', '-w', '\n%{http_code}', url],
                         capture_output=True).stdout.decode('utf-8', 'replace')
    body, _, code = out.rpartition('\n')
    return int(code or 0), body


_, sm = get(LIVE + '/sitemap.xml')
PATHS = [m.replace(LIVE, '') or '/' for m in re.findall(r'<loc>([^<]+)</loc>', sm)] + ['/404', '/401']


def jsonld(html):
    return re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S)


def norm(html):
    h = re.sub(r'<!--\s*Last Published:.*?-->', '', html, flags=re.S)
    if IGNORE_LD:
        h = re.sub(r'<script[^>]*application/ld\+json[^>]*>.*?</script>', '', h, flags=re.S)
    h = re.sub(r'data-wf-domain="[^"]*"', '', h)
    h = re.sub(r'data-wf-status="[^"]*"', '', h)
    h = h.replace(STAGING, LIVE).replace(STAGING_HOST, LIVE_HOST)
    h = re.sub(r'(' + SITE_NAME + r'\.webflow\.shared\.)[0-9a-f]+(\.(?:min\.)?css)', r'\1HASH\2', h)
    h = re.sub(r'(webflow\.[a-z]+\.)[0-9a-f]+(\.js)', r'\1HASH\2', h)
    h = re.sub(r'integrity="[^"]*"', '', h)
    h = re.sub(r'>\s*<', '>\n<', h)
    return h.splitlines()


def css_url(html):
    m = re.search(r'href="([^"]+\.webflow\.shared\.[^"]+\.css)"', html)
    return m and m.group(1)


def scripts(html):
    return re.findall(r'<script[^>]+src="([^"]+)"', html)


other = 0
for p in PATHS:
    sl, live = get(LIVE + p)
    ss, stag = get(STAGING + p)
    a, b = norm(live), norm(stag)
    d = [l for l in difflib.unified_diff(a, b, 'live' + p, 'staging' + p, n=0, lineterm='')]
    print(f'{p[:70]:72} live {sl} staging {ss} jsonld live {len(jsonld(live))} staging {len(jsonld(stag))} diff lines {len(d)}')
    if sl != ss:
        other += 1
    if d:
        other += 1
        print('\n'.join('    ' + l[:220] for l in d[:40]))
    if p == '/':
        lc, sc = css_url(live), css_url(stag)
        _, lcss = get(lc) if lc else (0, '')
        _, scss = get(sc) if sc else (0, '')
        print('  site CSS identical:', lcss == scss, f'({len(lcss)} vs {len(scss)} bytes)')
        if lcss != scss:
            other += 1
            for l in list(difflib.unified_diff(lcss.replace('}', '}\n').splitlines(), scss.replace('}', '}\n').splitlines(), n=0, lineterm=''))[:40]:
                print('   ', l[:220])
        for x, y in zip(scripts(live), scripts(stag)):
            if x == y:
                continue
            _, xa = get(x); _, ya = get(y)
            same = xa.replace(STAGING, LIVE) == ya.replace(STAGING, LIVE)
            print(f'  script {x.rsplit("/", 1)[-1]} vs {y.rsplit("/", 1)[-1]}: content identical {same} ({len(xa)} vs {len(ya)} bytes)')
            if not same:
                other += 1
print(f'\n{len(PATHS)} paths, {other} difference(s) other than' + (' JSON-LD' if IGNORE_LD else ' nothing (JSON-LD counted)'))
sys.exit(1 if other else 0)
