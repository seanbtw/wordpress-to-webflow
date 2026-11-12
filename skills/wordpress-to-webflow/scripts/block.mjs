// block.mjs — keeps third-party trackers quiet during verification runs: analytics and advertising requests are
// aborted, and form submissions to the hosts the config names are never sent.
//
// Usage:    import { guard, BLOCK } from './block.mjs';  await guard(browserContext);   (a Playwright browser context)
// Inputs:   checks.blockRequestRes (optional)   more regular expressions for request URLs to abort
//           checks.blockPostRes (optional)      more hosts whose POST requests are aborted, on top of the common
//                                               form vendors listed below, so a check can never submit a real form
// Outputs:  nothing on disk.
// Exit codes: none of its own (2 from the config loader when the config is missing).
import { opt } from './site.mjs';

const BASE = /googletagmanager|google-analytics|analytics\.google|doubleclick|facebook\.(net|com)|connect\.facebook|linkedin|licdn|lfeeder|hs-analytics|hs-banner|hscollectedforms|hs-scripts|hsadspixel|hotjar|clarity\.ms|bing\.com|twitter|tiktok|cookiebot|nitropack/i;
const MORE = opt('checks.blockRequestRes', []).map((s) => new RegExp(s, 'i'));
// Form vendors whose submissions are always held back, so a check can never create a real lead. Add your own in config.
const POST_BASE = /hsforms\.(com|net)|hubspot\.com|hubapi\.com|typeform\.com|formspree\.io|list-manage\.com|marketo|pardot|salesforce\.com|formstack\.com|jotform|webflow\.com\/api\/v1\/form/i;
const POSTS = [POST_BASE, ...opt('checks.blockPostRes', []).map((s) => new RegExp(s, 'i'))];

/** true when a request URL is a tracker that must not fire from a verification run */
export const BLOCK = { test: (u) => BASE.test(u) || MORE.some((r) => r.test(u)) };

export async function guard(context) {
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (BLOCK.test(u)) return route.abort();
    if (route.request().method() === 'POST' && POSTS.some((r) => r.test(u))) return route.abort();   // never submit forms
    return route.continue();
  });
}
