"""site_config.py: finds and reads the site config for the Python scripts (the same rules as site.mjs).

Usage:    from site_config import config, need, opt, origin, at, inventory, verify, has
          Each script adds its own folder to the module path first, so this also works under `python3 -I`.
Inputs:   the config file, found in this order:
            1. --config <path> on the command line
            2. the SITE_CONFIG environment variable
            3. ./site.config.json in the current directory
          Paths written in the config are read relative to the folder the config file is in (the project folder).
Outputs:  nothing on disk.
Exit codes: 2 when the config file is missing or unreadable, or when a script asks for a key that is not set
          (the message names the key).
Standard library only. Secrets never go in the config file.
"""
import json, os, re, sys

ARGV = sys.argv[1:]


def stop(message):
    print('site config: ' + message, file=sys.stderr)
    sys.exit(2)


def _locate():
    if '--config' in ARGV:
        i = ARGV.index('--config')
        if i + 1 >= len(ARGV): stop('--config needs a path after it')
        return os.path.abspath(ARGV[i + 1]), '--config'
    if os.environ.get('SITE_CONFIG'):
        return os.path.abspath(os.environ['SITE_CONFIG']), 'SITE_CONFIG'
    return os.path.abspath('site.config.json'), './site.config.json'


CONFIG_FILE, _FOUND_BY = _locate()
if not os.path.exists(CONFIG_FILE):
    stop(f'no config file at {CONFIG_FILE} (looked via {_FOUND_BY}). Pass --config <path>, set SITE_CONFIG, or run from the folder that holds site.config.json.')
try:
    with open(CONFIG_FILE, encoding='utf-8') as f: config = json.load(f)
except ValueError as e:
    stop(f'{CONFIG_FILE} is not valid JSON: {e}')

ROOT = os.path.dirname(CONFIG_FILE)   # the project folder


def _look(key):
    v = config
    for k in key.split('.'):
        if not isinstance(v, dict) or k not in v: return None
        v = v[k]
    return v


def _unset(v):
    return v is None or v == '' or (isinstance(v, str) and re.fullmatch(r'<.*>', v.strip()) is not None)


def need(key):
    """A required config value, e.g. need('webflow.stagingOrigin'). Stops with a message naming the key when it is not set."""
    v = _look(key)
    if _unset(v): stop(f'missing key "{key}" in {CONFIG_FILE} (not set, empty, or still a <placeholder>)')
    return v


def opt(key, fallback=None):
    """An optional config value with a fallback."""
    v = _look(key)
    return fallback if _unset(v) else v


def origin(key):
    """A required origin (scheme + host) without a trailing slash."""
    return str(need(key)).rstrip('/')


def at(*parts):
    """A path inside the project folder."""
    return os.path.normpath(os.path.join(ROOT, *parts))


def inventory(name):
    """A file in the inventory folder (paths.inventoryDir)."""
    return at(need('paths.inventoryDir'), name)


def verify(*name):
    """A file in the verification folder (paths.verifyDir). The folder is created if needed."""
    f = at(need('paths.verifyDir'), *name)
    os.makedirs(os.path.dirname(f), exist_ok=True)
    return f


def has(flag):
    return flag in ARGV
