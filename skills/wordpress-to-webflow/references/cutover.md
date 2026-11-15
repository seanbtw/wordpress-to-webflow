# Cutover runbook

Cutover is done with the site owner present. It is never part of an unattended run: it changes DNS, production indexing and where form submissions land.

## Before the day

1. **Freeze content on WordPress.** Agree the date with the people who edit the site. Two days is usually enough.
2. **Find what changed.** With SSH and WP-CLI on the host, read-only queries on live compared with the same queries on the local copy show what changed since the backup in minutes (see `wordpress-side.md`, "Reading the live site"); use that to size the re-sync, then take the fresh backup. **Fresh backup → refresh the local copy → rerun the inventory script. Diff every inventory by content hash**, not just posts: page block trees, navigation, options, SEO, assets, redirects. Apply each change to the right place: the idempotent CMS import (identity by WordPress id handles slug changes with redirects, unpublishing and deletions), page edits for changed block trees, navigation and footer, new assets. List any edits made on the Webflow side since the build and do not overwrite them.
3. **Dry run** one of each kind of change first: a changed static page, a navigation or option change, an image replacement, a slug change, an unpublished item. Confirm each lands.
4. **Re-export the host's redirect rules**, diff against the earlier export, rerun the live capture and the redirect build, and import the complete set (the import replaces everything).
5. **Record current DNS**: every record, including mail (MX, SPF, DKIM), and the exact rollback values.
6. **Decide what loads on the live domain and when**: analytics, tag manager, form tracking, cookie banner. Scripts gated to the live hostname only start at cutover; test them beforehand by serving staging pages under the live hostname in a test browser with data-sending requests blocked.
7. **Form test procedure agreed with whoever owns the CRM**: a named test contact and how it is suppressed or removed. No live form submission before that.
8. **Lower DNS TTL** a day ahead.
9. **If the site was built without a site plan**, add the plan now and do what was waiting for it, in this order: import the complete redirect file and run the URL checker's redirect rows; index the site for search and run the search checks; set the sitemap exclusions, switch on the generated sitemap and, if your `robots.txt` carries its own Sitemap line, tick "Remove sitemap.xml from robots.txt"; re-test any list that published empty on the unpaid site.
10. **Other hosts under the same domain stay exactly as they are.** Tools and widgets on subdomains can carry real search traffic of their own. Change only the records Webflow asks for, and check each subdomain still answers afterwards.
11. Add both the bare domain and `www` in Webflow hosting and choose the default (the other must redirect, not serve a second copy). Note the DNS records Webflow displays. Do the final checks on the webflow.io address; certificates for the real domain are only issued once DNS points at Webflow.

## The day

1. Point DNS at Webflow with the records it displayed. Publish to the custom domains. Confirm SSL is issued for both the bare domain and `www`, and that the non-default one redirects.
2. Turn production indexing on. Staging stays off.
3. Submit the sitemap in Search Console.
4. Launch checks, each with a named owner: critical forms, search, the priority URLs, the full URL checker against the live domain, redirects, analytics and consent, indexability (robots.txt, meta robots, sitemap), media, structured data (now testable with Google's Rich Results Test).
5. Know in advance which failures mean rollback, and how form submissions made during a rollback window are preserved.

## After

- Keep the old host running read-only. At 30 days, review: media independence proven (crawl with the old host blocked), URL coverage, monitoring quiet, backups retained. Cancel the old hosting only when all pass.
- Keep every migrated redirect for at least a year.
- Measure against the Search Console baseline recorded before the build: positions and clicks for the pages that mattered.
- Delete any abandoned earlier attempt on Webflow once the owner agrees.
