// glued-words.mjs — finds words that are glued together on Webflow but are two words on WordPress (a span's
// trailing space lost when the page or a rich-text body was built). It reads the served text of the same page on
// both sides and reports Webflow words that equal two adjacent WordPress words.
//
// Usage:    node glued-words.mjs /path [/path …] [--config site.config.json]
// Inputs:   wordpress.localOrigin (the page is fetched at <path>/), webflow.stagingOrigin (fetched at <path>)
// Outputs:  JSON on standard output: { "/path": ["gluedWord", …] } (up to 8 per page), or "fetch failed" for a path
//           that did not answer 200 on both sides. An empty object means nothing was found.
// Exit codes: 0 nothing glued; 1 something glued or a page could not be fetched; 2 config missing or no path given.
// Network:  the local WordPress copy and the staging origin. A 429 is waited out and retried.
import { origin, positionals } from './site.mjs';

const WP = origin('wordpress.localOrigin');
const WF = origin('webflow.stagingOrigin');
const BLOCK = /<\/?(p|div|h[1-6]|li|ul|ol|br|section|article|td|tr|table|header|footer|nav|figure|figcaption|blockquote|main|button|img)\b[^>]*>/gi;
const text = (h) => h.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(BLOCK, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&#8217;|&rsquo;|’/g, "'").replace(/&#8216;|&lsquo;|‘/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|“|”/g, '"')
  .replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#\d+;|&[a-z]+;/g, '');
const words = (t) => new Set(t.split(/\s+/).filter(Boolean));
const get = async (u) => {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u);
    if (r.status === 429) { await new Promise((s) => setTimeout(s, 4000)); continue; }
    return r.status === 200 ? r.text() : '';
  }
  return '';
};

const paths = positionals();
if (!paths.length) { console.error('glued-words: give at least one path, for example: node glued-words.mjs /about /blog/a-post'); process.exit(2); }
const out = {};
for (const p of paths) {
  const [a, b] = await Promise.all([get(WP + p + (p.endsWith('/') ? '' : '/')), get(WF + p)]);
  if (!a || !b) { out[p] = 'fetch failed'; continue; }
  const wa = words(text(a)), ta = text(a).split(/\s+/);
  const pairs = new Set();
  for (let i = 0; i < ta.length - 1; i++) pairs.add(ta[i] + ta[i + 1]);
  const glued = [...words(text(b))].filter((w) => !wa.has(w) && pairs.has(w) && w.length > 3);
  if (glued.length) out[p] = glued.slice(0, 8);
}
console.log(JSON.stringify(out, null, 1));
process.exit(Object.keys(out).length ? 1 : 0);
