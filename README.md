# wordpress-to-webflow

A Claude skill for rebuilding a WordPress site in Webflow so that it looks and behaves the same, keeps every URL that matters, and stays editable by the site's own team.

It was written from one full migration (about 500 CMS items, 30 pages, 24 theme blocks) and three follow-up structured-data jobs. It holds the method, the phase gates, the Webflow limits met along the way with their workarounds, and the checking scripts.

It is shared as working notes, not a product: the Webflow behaviour described was observed on one plan in November 2026, and the scripts were generalised from the ones used on that migration and then exercised against test fixtures, not yet against a second real site.

## What is inside

```
skills/wordpress-to-webflow/
  SKILL.md                      the method, the phases, where to look
  references/
    phases.md                   each phase and its "done when" list
    wordpress-side.md           local copy of the old site, inventories
    import.md                   field mapping, two-pass import, media, bodies
    webflow-traps.md            Webflow API, MCP and Designer limits
    redirects.md                URL manifest, redirect syntax, checker
    verification.md             every check, code parity, the new-item test
    structured-data.md          JSON-LD pattern, safe publishing, Wikidata
    cutover.md                  the DNS switch and after
    example-theme-mapping.md    one block theme mapped to Webflow, as a model
  scripts/                      config-driven checking and redirect tools
  assets/site.config.example.json
```

## Install

Claude Code, for one person:

```bash
ln -s "$(pwd)/skills/wordpress-to-webflow" ~/.claude/skills/wordpress-to-webflow
```

Or copy `skills/wordpress-to-webflow` into a project's `.claude/skills/` folder.

## Use

Ask for the job in plain words: "move this WordPress site to Webflow", "turn these redirect rules into Webflow redirects", "add schema markup to our Webflow site", "check the rebuild against the old site". The skill loads the part it needs.

The scripts need Node 20 or later and, for some, Playwright; see `skills/wordpress-to-webflow/scripts/README.md`.

## What is not here

No client content, no site ids, no keys, and no theme source code. Site-specific values live in a `site.config.json` you write per project; secrets live in a local `.env` that is never committed.

## Licence

MIT. See `LICENSE`.

## Status

Version 0.1. The Webflow notes are dated November 2026; Webflow changes, so re-test a limit before leaning on it.
