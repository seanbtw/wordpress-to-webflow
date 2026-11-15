#!/usr/bin/env python3
"""archive-check.py: proves the unpacked backup is the backup. Every file in the zip must be on disk at its exact
path (exact letter case) with the same size. Also finds names that differ only in letter case: a case-insensitive
disk (the macOS default) keeps one of each pair and says nothing.

Usage:    python3 -I archive-check.py <backup.zip> <extracted folder> [--also <folder> ...]
                                      [--extract-collisions <folder>] [--report <file>]

Inputs:   <backup.zip>            the host's backup archive
          <extracted folder>      where it was unpacked
          --also <folder>         more folders to look in, each holding files at their zip path (for example files
                                  moved out of the runtime copy before first boot: the archive's wp-config.php,
                                  the host's must-use plugins, cache drop-ins). May be given more than once.
          --extract-collisions    write both copies of every case-only pair here, as <folder>/0/<path> and
                                  <folder>/1/<path>, straight from the zip. The check then looks there for those
                                  paths, and prints the pairs so the media build can be pointed at them.
          --report <file>         also write the summary and the full lists to this file

Outputs:  a summary on standard output (and in --report): files in the zip, files found, missing, size mismatches,
          case-only pairs.
Exit codes: 0 nothing missing and no size mismatch; 1 something missing or mismatched, or case-only pairs exist and
          --extract-collisions was not given; 2 bad arguments.

Names are compared after Unicode normalisation (NFC), read with Python's zipfile: `unzip -l` mangles names that
contain characters such as en dashes. Existence is checked with an exact-case directory listing, because
os.path.exists answers yes for the wrong case on a case-insensitive disk.

Standard library only. Network: none.
"""
import os, sys, unicodedata, zipfile

sys.dont_write_bytecode = True
N = lambda s: unicodedata.normalize('NFC', s)


def stop(msg):
    print('archive-check: ' + msg, file=sys.stderr); sys.exit(2)


args = sys.argv[1:]
also, side, report, pos = [], None, None, []
i = 0
while i < len(args):
    a = args[i]
    if a in ('--also', '--extract-collisions', '--report'):
        if i + 1 >= len(args): stop(a + ' needs a path after it')
        v = os.path.abspath(args[i + 1]); i += 2
        if a == '--also': also.append(v)
        elif a == '--extract-collisions': side = v
        else: report = v
        continue
    pos.append(a); i += 1
if len(pos) != 2: stop('usage: archive-check.py <backup.zip> <extracted folder> [--also <folder>] [--extract-collisions <folder>] [--report <file>]')
ZIP, ROOT = pos[0], os.path.abspath(pos[1])
if not os.path.isfile(ZIP): stop(f'{ZIP} not found')
if not os.path.isdir(ROOT): stop(f'{ROOT} is not a folder')

z = zipfile.ZipFile(ZIP)
files = {}   # NFC name -> ZipInfo
for info in z.infolist():
    if not info.filename.endswith('/'): files[N(info.filename)] = info

# names that collide when lower-cased
by_lower = {}
for name in files: by_lower.setdefault(name.lower(), []).append(name)
pairs = sorted(sorted(v) for v in by_lower.values() if len(v) > 1)
collide = {}   # name -> index within its group
for group in pairs:
    for n, name in enumerate(group): collide[name] = n

if side and pairs:
    for name, n in collide.items():
        dest = os.path.join(side, str(n), name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with z.open(files[name]) as src, open(dest, 'wb') as out: out.write(src.read())

_listing = {}


def real_size(path):
    """size of the file at exactly this path and letter case, or None"""
    d, f = os.path.split(path)
    if d not in _listing:
        try: _listing[d] = {N(x) for x in os.listdir(d)}
        except (FileNotFoundError, NotADirectoryError): _listing[d] = set()
    return os.path.getsize(path) if N(f) in _listing[d] else None


missing, mismatch, from_side, from_also = [], [], 0, 0
for name, info in files.items():
    places = []
    if side and name in collide: places.append(('side', os.path.join(side, str(collide[name]), name)))
    else: places.append(('root', os.path.join(ROOT, name)))
    places += [('also', os.path.join(a, name)) for a in also]
    found = None
    for kind, p in places:
        s = real_size(p)
        if s is not None: found = (kind, s); break
    if found is None: missing.append(name)
    else:
        if found[1] != info.file_size: mismatch.append(name)
        if found[0] == 'side': from_side += 1
        if found[0] == 'also': from_also += 1

bad_crc = z.testzip()
lines = [
    f'zip: {len(files)} files',
    f'found at their exact path: {len(files) - len(missing)}' + (f' ({from_side} in the collisions folder, {from_also} in --also folders)' if from_side or from_also else ''),
    f'missing: {len(missing)}',
    f'size mismatches: {len(mismatch)}',
    f'integrity: {"pass" if bad_crc is None else "FAIL at " + bad_crc}',
    f'names that differ only in letter case: {len(pairs)} group(s)' + ('' if not pairs else (' (both copies extracted to ' + side + ')' if side else ' (a case-insensitive disk keeps one of each: rerun with --extract-collisions <folder>)')),
]
print('\n'.join(lines))
for group in pairs[:20]: print('  case-only: ' + '  |  '.join(group))
if len(pairs) > 20: print(f'  … and {len(pairs) - 20} more (see --report)')
for label, items in (('missing', missing), ('size mismatch', mismatch)):
    for name in items[:20]: print(f'  {label}: {name}')
if report:
    os.makedirs(os.path.dirname(os.path.abspath(report)), exist_ok=True)
    with open(report, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n\n')
        f.write('case-only groups (tab-separated):\n' + ''.join('\t'.join(g) + '\n' for g in pairs))
        f.write('\nmissing:\n' + ''.join(n + '\n' for n in missing))
        f.write('\nsize mismatches:\n' + ''.join(n + '\n' for n in mismatch))
sys.exit(1 if (missing or mismatch or bad_crc is not None or (pairs and not side)) else 0)
