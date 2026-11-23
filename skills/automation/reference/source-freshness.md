# Source freshness — what the console says about how current each source is

The console and Slack can drift apart, and the fix is being
upfront about any problem syncing Slack so the owner can be aware of it. The line sits only inside the
panels drawn from the corpus; the sidebar carries none of it (see below).

## The verb

```bash
slopweaver automation freshness          # one line per source
slopweaver automation freshness --json   # what the console polls (slug `source-freshness`, fast lane)
```

It prints one row per fetchable source (`FETCHABLE_SOURCES`). The verdict is the Fleet Briefing's own judge
(`src/briefing/freshness.ts`), run on the corpus half only, so the console and the briefing can never disagree
about a source. The projection is `src/briefing/sourceFreshness.ts`. The verb always exits 0: a source in
trouble is still a report, not a failure.

## What "verified" means, and its one limit

A source's age is its **last verified sync**: `lastSuccessAtIso` in
`$SLOPWEAVER_HOME/live/recipe/resync-state/<recipeId>.json`, the last scheduled resync whose rows reached the
store. A hand-run `slopweaver refresh` does NOT move this clock. Its sync-run ledger closes before the store leg,
so it cannot prove the rows landed. Run `automation resync --source <source>` to move it. That is why a source can
read late straight after someone refreshed it by hand.

The row also carries the store's **newest record**, and a verified sync sitting over an old record reads
`unverified`, never `current`.

## States

Each row has one state. When more than one applies, the first in this list wins: `unreadable`, `blocked`,
`paused`, `unscheduled`, `failing`, `never-synced`, `late`, `unverified`, `current`. `marks` keeps every flag
that applies.

- **Drawn in the accent colour**: every state except `current` and `unverified`.
- **Drawn in the warning colour**: `unverified`. A quiet source (a mailbox with nothing new, a recorder with no
  calls) reads unverified by construction, measured on Gmail and Fathom at once.
- A `current` or `unverified` row the page's clock carries past its window reads `late` until the next report.
  Polls hold during a voice call, so the report can be older than the page.
- **Cannot read the report**: a staleness mark whose hover says why, never blank.

## Where it is drawn

Not in the sidebar: a per-source strip and its "N more" notice read as noise (every source showing
unscheduled), so neither is drawn.

- `site/components/console/SourceFreshness.tsx`: `SourceFreshnessLine`. The Slack panels (`SlackThread`, the
  pull-requests sync note) show the stored copy's age beside their own "read" receipt. "Read" is when the page
  fetched the copy, not how current the copy is.
- The wording is in `site/lib/sourceFreshness.ts`, which only words the verb's verdict; each state's colour is
  `site/lib/sourceFreshnessTones.ts`.
