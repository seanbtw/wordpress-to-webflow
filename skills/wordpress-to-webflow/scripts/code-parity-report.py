#!/usr/bin/env python3
"""code-parity-report.py: writes the live vs Webflow code table from the inventory code-parity.py made, with a
verdict for every item. An item both sides have is "same". An item only one side has needs a verdict from you,
written in a verdicts file; anything without one is listed as UNCLASSIFIED, so nothing is dropped silently.

Usage:    python3 -I code-parity-report.py [--config site.config.json]

Inputs:   <verifyDir>/code-parity/inventory.json    from code-parity.py
          <verifyDir>/code-parity/verdicts.json (optional; without it every one-sided item is UNCLASSIFIED):
            { "items":    { "<item key>": ["<verdict>", "<reason>"] },
              "patterns": [ ["<regular expression on the item key>", "<verdict>", "<reason>"] ] }
          Item keys are as printed in the table: script:<host/path>, inline:<purpose>, link:<rel>, meta:<name>,
          jsonld:<type>, noscript:<what>, iframe:<host/path>.
          Verdicts used so far: "same", "intentional omission", "MISSING → fixed", "MISSING → needs a decision".
          An item on both sides is shown as "same", unless its verdict is "MISSING → fixed" (it was missing and now
          is not), which is shown with its reason.
Outputs:  <verifyDir>/code-parity.md
Exit codes: 0 every item has a verdict; 1 at least one item is UNCLASSIFIED; 2 config or the inventory missing.
Standard library only. Network: none.
"""
import json, os, re, sys

sys.dont_write_bytecode = True   # leave no __pycache__ beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_config import verify, stop

D = os.path.dirname(verify('code-parity', 'inventory.json'))
if not os.path.exists(os.path.join(D, 'inventory.json')): stop(f'{os.path.join(D, "inventory.json")} not found (run code-parity.py first)')
with open(os.path.join(D, 'inventory.json'), encoding='utf-8') as f: inv = json.load(f)
SAME, FIXED = 'same', 'MISSING → fixed'
V, PATTERNS = {}, []
if os.path.exists(os.path.join(D, 'verdicts.json')):
    with open(os.path.join(D, 'verdicts.json'), encoding='utf-8') as f: vf = json.load(f)
    V = {k: tuple(v) for k, v in vf.get('items', {}).items()}
    PATTERNS = [(p[0], (p[1], p[2] if len(p) > 2 else '')) for p in vf.get('patterns', [])]
# metas every page has on both systems, or that say nothing about parity
SKIP_META = ('charset', 'viewport', 'theme-color', 'msapplication-tilecolor', 'twitter:site')


def verdict_for(k):
    if k in V: return (V[k][0], V[k][1] if len(V[k]) > 1 else '')
    for rx, v in PATTERNS:
        if re.search(rx, k): return v
    return ('UNCLASSIFIED', '')


def items(side):
    out = {}
    for s in side['scripts']:
        if 'src' in s: out['script:' + s['src']] = s['src']
        else:
            for p in s['inline']: out['inline:' + p] = p
    for l in side['links']: out['link:' + l['rel']] = l['rel']
    for m in side['metas']:
        if m['key'] not in SKIP_META: out['meta:' + m['key']] = m['content']
    for j in side['jsonld']: out['jsonld:' + j] = j
    for n in side['noscript']: out['noscript:' + n] = n
    for i in side['iframes']: out['iframe:' + re.sub(r'video/\d+', 'video/<id>', i)] = i
    return out


L = ['# Live vs Webflow code parity', '',
     'One page of every template, the live site against Webflow staging (inventory: `code-parity/inventory.json`, raw HTML: `code-parity/raw/`). '
     'Verdicts: **same** · **intentional omission** (with the reason) · **MISSING → fixed** · **MISSING → needs a decision** · **UNCLASSIFIED** (no verdict yet).', '']
for slug, v in inv.items():
    li, wi = items(v['live']), items(v['wf'])
    L += [f'## {slug}: live `{v["paths"][0]}` · Webflow `{v["paths"][1]}`', '', '| Item | Live | Webflow | Verdict |', '|---|:-:|:-:|---|']
    for k in sorted(set(li) | set(wi)):
        inl, inw = k in li, k in wi
        vv = verdict_for(k)
        if inl and inw: verdict, reason = (FIXED, vv[1]) if vv[0] == FIXED else (SAME, vv[1] if vv[0] == SAME else '')
        else: verdict, reason = vv
        L.append(f'| `{k}` | {"✓" if inl else "—"} | {"✓" if inw else "—"} | {verdict}{(": " + reason) if reason else ""} |')
    L += ['', f'`<html>` live lang={v["live"]["html"].get("lang")} · Webflow lang={v["wf"]["html"].get("lang")}; `<body>` live class="{v["live"]["body"].get("class")}" · Webflow class="{v["wf"]["body"].get("class")}"', '']
with open(verify('code-parity.md'), 'w', encoding='utf-8') as f: f.write('\n'.join(L) + '\n')
unc = [l for l in L if 'UNCLASSIFIED' in l and l.startswith('|')]
print(len(L), 'lines;', len(unc), 'unclassified →', verify('code-parity.md'))
print('\n'.join(unc[:20]))
sys.exit(1 if unc else 0)
