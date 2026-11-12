# Draws the readme pictures (banner and phases, each in light and dark) as SVG.
# Usage: python3 docs/make-pictures.py docs
# Edit the counts in banner() and the PHASES list here, then rerun; do not edit the SVG files by hand.
import sys, os, html
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
PAL = {
 'light': dict(bg='#f6f8fa', panel='#ffffff', line='#d0d7de', ink='#1f2328', muted='#59636e', faint='#afb8c1',
               accent='#4f46e5', accentSoft='#e0e7ff', ok='#1a7f37', okSoft='#dafbe1', wire='#c7ced6', wireFill='#eef1f4'),
 'dark':  dict(bg='#0d1117', panel='#161b22', line='#30363d', ink='#f0f6fc', muted='#9198a1', faint='#484f58',
               accent='#a5b4fc', accentSoft='#1e1b4b', ok='#3fb950', okSoft='#0f2a17', wire='#545d68', wireFill='#21262d'),
}
def esc(s): return html.escape(s, quote=False)

def page(x, y, p, stroke, fill, w=130, h=200):
    g = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{p["panel"]}" stroke="{stroke}" stroke-width="1.5"/>']
    g.append(f'<rect x="{x+10}" y="{y+10}" width="{w-20}" height="8" rx="4" fill="{fill}"/>')                # nav
    g.append(f'<rect x="{x+10}" y="{y+28}" width="{w-20}" height="52" rx="5" fill="{fill}"/>')               # hero
    g.append(f'<rect x="{x+20}" y="{y+44}" width="{w-70}" height="6" rx="3" fill="{stroke}"/>')
    g.append(f'<rect x="{x+20}" y="{y+56}" width="{w-90}" height="6" rx="3" fill="{stroke}"/>')
    cw = (w - 20 - 12) / 3
    for i in range(3):                                                                                           # cards
        g.append(f'<rect x="{x+10+i*(cw+6):.1f}" y="{y+90}" width="{cw:.1f}" height="40" rx="4" fill="{fill}"/>')
    for i, f in enumerate((1, 0.86, 0.94, 0.6)):                                                                 # text
        g.append(f'<rect x="{x+10}" y="{y+142+i*10}" width="{(w-20)*f:.1f}" height="4" rx="2" fill="{fill}"/>')
    g.append(f'<rect x="{x+10}" y="{y+h-16}" width="{w-20}" height="6" rx="3" fill="{fill}"/>')                # footer
    return '\n'.join(g)

def banner(p):
    W, H = 880, 300
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">',
         '<title id="t">WordPress to Webflow</title>',
         '<desc id="d">A Claude skill for rebuilding a WordPress site in Webflow. The old site and the rebuild are drawn side by side with a difference strip between them.</desc>',
         f'<rect x="0.75" y="0.75" width="{W-1.5}" height="{H-1.5}" rx="16" fill="{p["bg"]}" stroke="{p["line"]}" stroke-width="1.5"/>']
    # label chip
    s.append(f'<rect x="48" y="50" width="112" height="24" rx="12" fill="{p["accentSoft"]}"/>')
    s.append(f'<text x="104" y="66.5" text-anchor="middle" font-family="{SANS}" font-size="11" font-weight="700" letter-spacing="1.3" fill="{p["accent"]}">CLAUDE SKILL</text>')
    # title
    s.append(f'<text x="46" y="124" font-family="{SANS}" font-size="40" font-weight="700" letter-spacing="-0.8" fill="{p["ink"]}">WordPress <tspan fill="{p["accent"]}">to</tspan> Webflow</text>')
    s.append(f'<text x="48" y="162" font-family="{SANS}" font-size="17" fill="{p["muted"]}">Rebuild the site from its source, keep every URL,</text>')
    s.append(f'<text x="48" y="186" font-family="{SANS}" font-size="17" fill="{p["muted"]}">and prove the result by script.</text>')
    # facts row
    x = 48
    for label in ('10 gated phases', '9 reference files', '21 scripts'):
        w = 22 + len(label) * 6.6
        s.append(f'<rect x="{x}" y="222" width="{w:.0f}" height="28" rx="6" fill="{p["panel"]}" stroke="{p["line"]}"/>')
        s.append(f'<text x="{x + w/2:.1f}" y="240.5" text-anchor="middle" font-family="{SANS}" font-size="12.5" font-weight="600" fill="{p["ink"]}">{esc(label)}</text>')
        x += w + 10
    # motif: old site | diff strip | rebuild
    ax, bx, y = 524, 706, 44
    s.append(page(ax, y, p, p['wire'], p['wireFill']))
    s.append(page(bx, y, p, p['accent'], p['accentSoft']))
    sx = 668
    s.append(f'<rect x="{sx}" y="{y}" width="24" height="200" rx="6" fill="{p["panel"]}" stroke="{p["line"]}"/>')
    for i in range(19):
        yy = y + 10 + i * 10
        s.append(f'<rect x="{sx+7}" y="{yy}" width="10" height="2" rx="1" fill="{p["faint"]}" opacity="0.55"/>')
    # check badge on the rebuild
    cx, cy = bx + 130, y
    s.append(f'<circle cx="{cx}" cy="{cy}" r="13" fill="{p["ok"]}" stroke="{p["bg"]}" stroke-width="3"/>')
    s.append(f'<path d="M{cx-5.5} {cy+0.5} l3.8 3.8 l7.2 -7.6" fill="none" stroke="{p["bg"]}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>')
    for tx, label in ((ax + 65, 'old site'), (sx + 12, 'diff'), (bx + 65, 'rebuild')):
        s.append(f'<text x="{tx}" y="{y+220}" text-anchor="middle" font-family="{MONO}" font-size="10.5" fill="{p["muted"]}">{label}</text>')
    s.append('</svg>')
    return '\n'.join(s)

PHASES = [
 ('0',  'Reference',     ['Old site runs locally.', 'Everything inventoried,', 'counts generated.']),
 ('1',  'Design system', ['Tokens match the theme', 'on both sides of every', 'breakpoint.']),
 ('1b', 'Proof',         ['Five risky assumptions', 'settled on real content', 'before scaling up.']),
 ('2',  'Import',        ['Counts equal. A rerun', 'changes nothing. Every', 'asset resolves.']),
 ('3',  'Components',    ['Each block sits within', 'a few pixels of the', 'reference.']),
 ('4',  'Pages',         ['Every URL resolves and', 'section order is checked', 'by script.']),
 ('5',  'Behaviour',     ['Checklist ticked in', 'Chromium, Safari, iOS.', 'Console clean.']),
 ('6',  'Redirects',     ['Checker fails its', 'fixture, then passes', 'staging at 0 failures.']),
 ('7',  'Verification',  ['Twelve checks at zero.', 'Every difference listed', 'with its reason.']),
 ('8',  'Cutover',       ['Live checks pass, with', 'the owner. Old host', 'retired after 30 days.']),
]
def phases(p):
    W, H, cw, ch, gap = 880, 322, 164, 136, 14
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d">',
         '<title id="t">The ten phases and their gates</title>',
         '<desc id="d">' + esc(' '.join(f'Phase {n}, {t}: ' + ' '.join(l) for n, t, l in PHASES)) + '</desc>']
    for i, (n, title, lines) in enumerate(PHASES):
        col, row = i % 5, i // 5
        x, y = 2 + col * (cw + gap), 2 + row * (ch + 46)
        last = (n == '8')
        s.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" rx="10" fill="{p["panel"]}" stroke="{p["accent"] if last else p["line"]}" stroke-width="1.5"/>')
        bw = 34 if len(n) > 1 else 28
        s.append(f'<rect x="{x+14}" y="{y+14}" width="{bw}" height="28" rx="14" fill="{p["accentSoft"]}"/>')
        s.append(f'<text x="{x+14+bw/2}" y="{y+33}" text-anchor="middle" font-family="{SANS}" font-size="13" font-weight="700" fill="{p["accent"]}">{n}</text>')
        s.append(f'<text x="{x+14+bw+9}" y="{y+33.5}" font-family="{SANS}" font-size="14" font-weight="700" fill="{p["ink"]}">{esc(title)}</text>')
        s.append(f'<text x="{x+15}" y="{y+64}" font-family="{SANS}" font-size="9.5" font-weight="700" letter-spacing="1.1" fill="{p["ok"]}">DONE WHEN</text>')
        for j, line in enumerate(lines):
            s.append(f'<text x="{x+15}" y="{y+83+j*16}" font-family="{SANS}" font-size="11.5" fill="{p["muted"]}">{esc(line)}</text>')
        if col < 4:   # chevron to the next card
            ax, ay = x + cw + gap / 2, y + ch / 2
            s.append(f'<path d="M{ax-3} {ay-5} l5 5 l-5 5" fill="none" stroke="{p["faint"]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')
    # row connector: from the end of row 1 down and back to the start of row 2
    y1 = 2 + ch; ym = y1 + 23; xr = 2 + 4 * (cw + gap) + cw / 2; xl = 2 + cw / 2
    s.append(f'<path d="M{xr} {y1+6} V{ym-8} a8 8 0 0 1 -8 8 H{xl+8} a8 8 0 0 0 -8 8 V{y1+40}" fill="none" stroke="{p["faint"]}" stroke-width="1.8" stroke-linecap="round"/>')
    s.append(f'<path d="M{xl-5} {y1+36} l5 5 l5 -5" fill="none" stroke="{p["faint"]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')
    s.append('</svg>')
    return '\n'.join(s)

for mode, p in PAL.items():
    open(f'{out}/banner-{mode}.svg', 'w').write(banner(p) + '\n')
    open(f'{out}/phases-{mode}.svg', 'w').write(phases(p) + '\n')
print(sorted(os.listdir(out)))
