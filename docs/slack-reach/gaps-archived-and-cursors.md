# Five gaps this work closed

Part of [Slack reach — everything the token can read, and how we prove it](../slack-reach.md).

## 1. Archived channels were never even discovered

`conversations.list` was called with `exclude_archived: true`. Measured: the workspace holds hundreds of
conversations, a substantial archived fraction of everything reachable, invisible to bronze not because
the token was refused but because discovery never asked. A finished project's channel is archived precisely
BECAUSE the work concluded, which is what makes it worth reading. Discovery now asks for them
(`exclude_archived: false`) and each record carries `archived: true` so an answer can say so.

## 2. One pooled cursor could not express "never crawled"

`corpus/watermarks/slack.json` holds ONE cursor for the whole workspace, and every channel was read forward
from it. That is right for a channel already crawled and wrong for every other case — a channel created,
joined, un-archived, or simply missed by an earlier walk inherits a floor later than everything it contains,
and its whole prior history becomes unreachable short of re-crawling the entire workspace.

Measured before the fix: many reachable conversations carrying real messages held ZERO bronze rows,
including busy channels with histories spanning years. Both kinds are ordinary. Neither was ever refused by
Slack.

The fix mirrors what GitHub org mode already does per repository
(`src/corpus/github/repoWatermark.ts`): a per-channel store,
`$SLOPWEAVER_HOME/corpus/.slack-channels.watermark.json`, written by
`src/corpus/slack/channelWatermark.ts`.

- **A channel with no entry has never been backfilled** → it is read from the epoch, ONCE.
- **A channel with an entry** → it is read from its own cursor, which wins outright over the pooled window in
  both directions — but never over the CLOCK, below.
- **A channel that was read and held nothing still gets an entry.** This is the part that is easy to get
  wrong: derive the visited set from the records a crawl produced and every quiet channel is re-backfilled
  from the epoch on every single run. `computeChannelWatermarks` takes `visited` as a separate input for
  exactly this reason, and a channel whose read THREW is deliberately not in it — it stays eligible.
- **A bounded run (`--sample`, `--fetch-cap`) writes no entry at all.** An entry is the claim "this channel
  has been read to the end", and a capped run has not earned it. A false entry is worse than none: it removes
  the channel from the coverage report's gap list permanently.

An explicit `--since` / `--all` / `--lookback-days` suppresses the epoch backfill. Then the window IS the
request, and silently widening it would answer a question nobody asked. **Silently NARROWING one is the same
error and is invisible**, so a stored cursor may not lower a floor the caller named: `resumeExplicitWindow`
defers to a channel's own cursor only when the REQUEST's floor is the Slack epoch, which is the `--all` case
that makes a killed 36-hour backfill resumable. A `--since` is a deliberate re-read of a named span.

### No cursor may sit ahead of the clock

A cursor says how far through TIME a channel has been read, so one ahead of now claims a span nobody could
have read — and since that value IS the next run's ingest floor, everything posted between the clock and it is
dropped. The window's `until` is today+1, an exclusive upper bound, so a cursor banked at `until` puts every
channel that was read and held nothing at TOMORROW.

MEASURED on the operator's own home: **most of several hundred** conversations carried a bare-day cursor naming TOMORROW,
banked while the clock still read today. The refresh log read `slack D0SYN000003: history-oracle (walk from 0,
ingest from <tomorrow's midnight>)` against every other channel's ingest floor a day earlier, and a
`--since <two days ago> --lookback-days 2` re-walk of that DM reported success and wrote 0 rows. Read the shape of it back with:

```bash
jq '.channels | to_entries | map(.value.cursor[0:10]) | group_by(.) | map({d:.[0],n:length})' \
  "$SLOPWEAVER_HOME/corpus/.slack-channels.watermark.json"
```

The guard is two-sided, because the store merges MAX and a cursor on disk can never be lowered by a later run:
`clampCursorToClock` (`channelWatermark.ts`) stops the value being minted, and `planChannelOldest`
(`reach.ts`) caps the floor it reads back, which is what repairs a home already holding one. The identical
two-sided shape as the calendar fix (`calendar/ingest.ts#pooledCursor` plus
`calendar/fetch.ts#windowBounds`). The COVERAGE report never caught it, and could not: `classifyChannelReach`
reads an entry's PRESENCE, never its value.

**The class has three instances, and the third is the one that named it.** The POOLED watermark banks the
window's `until` for a source that saw no usable timestamp too, so `corpus/watermarks/fathom.json` held
tomorrow's date late in the evening of today, and every `resync-corpus-fathom` firing planned
`window <tomorrow>..<today>` — an empty provider filter, exit 3, which the resync judge correctly reads as
a quiet window. The same two halves answer it: `corpus/watermark.ts#computeSourceWatermarks` caps what a pass
banks, and `cli/commands/refresh/windows.ts#buildRefreshWindows` caps the cursor it reads back as
`window.since`. All three lanes now share ONE comparison, `lib/date.ts#clampIsoToClock` — three independent
copies of "never later than the clock" is how the class kept regenerating, because no rule had a single
function it could name.

That is also why `planChannelOldest` caps its whole RESULT rather than each branch, and the reason is
load-bearing: a future floor reaches the plan through the WINDOW as well as through the per-channel entry,
with no poisoned entry involved at all, so a per-branch cap would have covered the cursor and missed the
window.

**The store is deliberately NOT seeded from existing bronze**, which is the first optimisation anyone will
propose: the file starts empty, so the next full refresh reads every channel from the epoch once, even the
hundreds that already hold rows. Seeding it from "this channel has rows" would mark those channels backfilled
while their PRE-window history is still missing — the same false claim a bounded run is barred from making,
made in bulk. The one-time cost of re-reading is the price of the entry meaning what it says.
