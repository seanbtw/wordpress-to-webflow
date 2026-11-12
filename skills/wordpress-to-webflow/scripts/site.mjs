// site.mjs — finds and reads the site config, and holds the small helpers every script shares.
//
// Usage:    import { config, need, opt, origin, at, inventory, verify, arg, has, positionals, readCsv } from './site.mjs';
// Inputs:   the config file, found in this order:
//             1. --config <path> on the command line
//             2. the SITE_CONFIG environment variable
//             3. ./site.config.json in the current directory
//           Paths written in the config are read relative to the folder the config file is in (the project folder).
// Outputs:  nothing on disk. Exports the parsed config and helpers.
// Exit codes: 2 when the config file is missing or unreadable, or when a script asks for a key that is not set
//           (the message names the key).
// Secrets never go in the config file. The Webflow token is read only from the WEBFLOW_TOKEN environment variable
// (see wf-api.mjs).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);

function stop(message) {
  console.error('site config: ' + message);
  process.exit(2);
}

function locate() {
  const i = argv.indexOf('--config');
  if (i >= 0) {
    if (!argv[i + 1]) stop('--config needs a path after it');
    return [path.resolve(argv[i + 1]), '--config'];
  }
  if (process.env.SITE_CONFIG) return [path.resolve(process.env.SITE_CONFIG), 'SITE_CONFIG'];
  return [path.resolve('site.config.json'), './site.config.json'];
}

const [CONFIG_FILE, FOUND_BY] = locate();
if (!fs.existsSync(CONFIG_FILE)) {
  stop(`no config file at ${CONFIG_FILE} (looked via ${FOUND_BY}). Pass --config <path>, set SITE_CONFIG, or run from the folder that holds site.config.json.`);
}
let config;
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { stop(`${CONFIG_FILE} is not valid JSON: ${e.message}`); }

/** The project folder: where the config file is. */
const ROOT = path.dirname(CONFIG_FILE);

const look = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
const unset = (v) => v === undefined || v === null || v === '' || (typeof v === 'string' && /^<.*>$/.test(v.trim()));

/** A required config value, e.g. need('webflow.stagingOrigin'). Stops with a message naming the key when it is not set. */
function need(key) {
  const v = look(key);
  if (unset(v)) stop(`missing key "${key}" in ${CONFIG_FILE} (not set, empty, or still a <placeholder>)`);
  return v;
}

/** An optional config value with a fallback. */
function opt(key, fallback) {
  const v = look(key);
  return unset(v) ? fallback : v;
}

/** A required origin (scheme + host) without a trailing slash. */
const origin = (key) => String(need(key)).replace(/\/+$/, '');
/** An optional origin without a trailing slash, or null. */
const optOrigin = (key) => { const v = opt(key, null); return v ? String(v).replace(/\/+$/, '') : null; };

/** A path inside the project folder. */
const at = (...parts) => path.resolve(ROOT, ...parts);
/** A file in the inventory folder (paths.inventoryDir): the facts collected from WordPress. */
const inventory = (name) => at(need('paths.inventoryDir'), name);
/** A file in the verification folder (paths.verifyDir): what the checks write. The folder is created if needed. */
const verify = (...name) => {
  const f = at(need('paths.verifyDir'), ...name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  return f;
};

/** --flag value from the command line, or the fallback. */
const arg = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
/** true when --flag is on the command line. */
const has = (flag) => argv.includes(flag);
/** Command-line words that are not flags. Name every flag that takes a value so its value is skipped too. */
function positionals(valueFlags = []) {
  const takes = new Set(['--config', ...valueFlags]);
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (takes.has(argv[i])) { i++; continue; }
    if (argv[i].startsWith('--')) continue;
    out.push(argv[i]);
  }
  return out;
}

/** Reads a CSV file with a header row into a list of objects. Handles quoted commas, doubled quotes and quoted newlines. */
function readCsv(file) {
  const t = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ''])));
}

/** Reads a JSON file, stopping with a plain message (and the script that makes the file) when it is not there. */
function readJson(file, madeBy) {
  if (!fs.existsSync(file)) stop(`${file} not found${madeBy ? ` (run ${madeBy} first)` : ''}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Hosts that count as "the old WordPress site": the live host with and without www, and the local copy if there is one. */
function oldHosts() {
  const live = new URL(origin('site.liveOrigin')).host;
  const local = optOrigin('wordpress.localOrigin');
  return { live: [live, live.replace(/^www\./, '')], local: local ? new URL(local).host : null };
}

export { config, CONFIG_FILE, ROOT, need, opt, origin, optOrigin, at, inventory, verify, arg, has, positionals, readCsv, readJson, oldHosts, stop };
