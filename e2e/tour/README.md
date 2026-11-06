# The screenshot tour

`run.cjs` captures every page and every pop-up of BFO at phone (390×844) and
desktop (1440×900) widths, in light and dark, for a design, accounting and
legal review. Each surface is labelled with the files that draw it.

## Running it

Start the SPA first (`npm run dev`, port 5173), then:

```sh
# Live records, read-only (the default). live.cjs needs its environment:
# BFO_TOUR_SESSION (a session file, never in the repo), BFO_TOUR_CACHE, and
# optionally BFO_TOUR_PLAID=1 and BFO_TOUR_UNREAD. See the top of live.cjs.
node e2e/tour/run.cjs

# The browser checks' small fixtures instead (e2e/fixtures.cjs), or another
# module with the same { session, mock } shape:
node e2e/tour/run.cjs --mock
node e2e/tour/run.cjs --mock=path/to/fixtures.cjs

# A few surfaces (a trailing * matches a prefix), one size, one theme:
node e2e/tour/run.cjs --only home,palette,entity-* --sizes desk --themes dark

# Elsewhere, or with more pages at once (default 4):
node e2e/tour/run.cjs --out /tmp/tour-round-2 --workers 6
BASE=http://localhost:5174 PW_CHROMIUM=/path/to/chrome node e2e/tour/run.cjs
```

Captures land in `${OUT}/<surface id>/<size>-<theme>.png`, with
`${OUT}/manifest.json` beside them. The default `OUT` is in the session's
scratchpad, outside the repo: live captures are the family's records and
never belong in git. A run with `--only` updates those surfaces in an
existing manifest and keeps the rest, so a round of fixes can be re-captured
without the whole tour.

## What the manifest says

For each surface: its id, kind (page or popup), title, path, files and note,
and for each capture the URL it reached, whether the recipe got there, page
and console errors, the API requests other than GETs it made, and what the
read-only guard refused (`load:` refusals mean the page shows less than it
would for real; `steps:` refusals mean a click was stopped). The top lists
failed recipes, surfaces that can't be reached, degraded pages and live.cjs's
counts.

## Writing a recipe

A surface is one entry in `PAGES` or `POPUPS`. It opens `path` (or `go`
finds a real record and opens it: nothing is identified by a fixed id), runs
`steps` to reach a state, and is captured. Find controls by role and name.
Recipes only open things: never click anything that sends, syncs, files,
signs, deletes, connects, categorizes, saves, marks read or pays. A confirm
is opened and left open. `steps: null` lists a surface that can't be reached,
with a note saying why.
