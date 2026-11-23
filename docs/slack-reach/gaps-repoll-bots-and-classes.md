# 3. Every known thread was re-polled, to discover that 0.67 % of them had moved

Part of [Slack reach — everything the token can read, and how we prove it](../slack-reach.md).

Calling `conversations.replies` once per key in `$SLOPWEAVER_HOME/corpus/.slack-threads.json`,
unconditionally, is correct and closes a real gap — a thread gains replies long after its parent's
timestamp, which a watermark-bounded history walk never returns — and it is **93.9 %** of a crawl's
traffic. Measured: **some fifty thousand** replies calls workspace-wide, 18.3 h at Tier 3, to find that
**a couple of hundred threads of about thirty thousand** (0.67 %) had gained a reply that day.

`conversations.history` already answers the question, on every thread root it returns, for a parent of ANY
age: `reply_count`, `reply_users_count` and `latest_reply`. And `latest_reply` is the same quantity the
crawl already stores as each thread's cursor, so the skip test is `latest_reply > storedCursor` against state
that already exists. The belief that "a reply does not move its parent's ts, so
`conversations.history` never returns that parent" is true only of a watermark-BOUNDED fetch, and false of
a full page walk.

**Two lanes, chosen per channel** (`src/corpus/slack/threadOracle.ts`, wired by `planChannelRead` in
`reach.ts`):

- **`history-oracle`** — walk the channel's whole history at `limit=999` and let each root's own fields say
  which threads moved. The walk's `oldest` is the epoch; the INGEST floor stays exactly where it was, so
  bronze receives the rows a bounded read would have given it and the completion marker still means what it
  said. Measured on the thread-densest channel: **6 calls in 22.6 s** against a few thousand calls in ~95 min.
- **`poll-known-threads`** — the pre-oracle behaviour, kept for a channel with more history pages than
  threads. One measured bot firehose holds over a million top-level messages and a few dozen threads, where an
  always-walk policy costs about a thousand calls to check a few dozen. `min(pages, threads)` is the difference
  between nearly two thousand calls workspace-wide and **a few hundred**.

The lane needs the channel's size, so a completed walk records it as `messages` on that channel's watermark
entry. A channel whose size has never been recorded takes the oracle lane — the walk is what learns it.

**The lane rule reads STORED state, so it can be wrong for exactly one pass, and that is a windowed run's
exposure too.** `chooseThreadDetectionLane` compares a `messages` count a previous completed walk wrote
against the live thread count; nothing re-validates it mid-run. A channel whose count is absent or badly
stale can therefore take an epoch walk that costs more than the bounded one it replaced — a never-counted
channel holding 1,000,000 messages and 3 threads is 1,002 pages against a 3-call sweep. It is bounded and
self-correcting, because that walk records the true size and the next pass routes to the poll lane, and
MEASURED, every channel holding a stored cursor also had a recorded count. An unpinned run and a
windowed one carry this exposure alike.

**The lane decision runs in every window mode, and that is the point of two `oldest` bounds.** An explicit
window (`--since`/`--until`/`--all`/`--lookback-days`) governs INGEST and nothing else: `rowsToIngest`
filters every walked row by `ingestOldest` before it is shaped, and the `fullHistory` completion marker is
keyed to `ingestOldest` too (`workspaceCrawl.ts`), so an epoch-wide walk under `--since 2001-01-01` writes
byte-for-byte the bronze that request asked for. A walk is a read. MEASURED on a live
workspace holding tens of thousands of stored cursors across hundreds of channels: pinning every channel to
`poll-known-threads` under a window costs orders of magnitude more replies calls than when the lane is free
to choose. The sweep costs a fixed fraction of a second per thread on top of a floor every channel pays
(discovery, users, members, structures), so a windowed pass turned a minutes-long default into hours of
polling, and every one died at its timeout having written nothing, while the unpinned default finished and
wrote records. Proof after the fix: the two channels that stalled, `C0SYN000002` and `C0SYN000036`, both holding
many stored threads, both took the oracle lane and finished together in minutes. Reproduce with
`slopweaver refresh --source slack --lookback-days 2 --no-derive --slack-channel <id>`.

**What a caller-pinned FLOOR does still change** is about a thread the walk NAMES rather than a row it
returns, and it splits three ways on one fact — **a reply is always newer than its parent**
(`cursorlessRootFloor`, `channelPages.ts`):

- a root **with a stored cursor** is polled from that cursor, which is a fetched-through claim and honest
  whatever the request asked for;
- a cursorless root **at or above `ingestOldest`** — a thread created inside the requested window, which is
  the main thing a catch-up run is for — can have no reply below the floor, so it is polled from
  `ingestOldest`: the whole thread, and a cursor that honestly covers it;
- a cursorless root **below `ingestOldest`** is the only real conflict — read whole it drags a years-old
  thread's replies in under a `--since`, read bounded it stores a cursor claiming coverage nobody fetched —
  so it is DEFERRED: no call, nothing ingested, no cursor recorded.

`ChannelReadPlan.pinnedWindow` is `!backfillNew && ingestOldest > 0`, not merely `!backfillNew`: `--all` pins
a window whose own floor IS the epoch, nothing can sit below it, and it reads an unseen root whole — which is
exactly the backfill it asked for. A deferral drops nothing either: the fallback sweep walks stored cursors,
which a cursorless root is not among, and the next refresh with no pinned floor reads it whole.

**A row is a thread root iff it carries `latest_reply`**, never `thread_ts`. Measured on one 999-row page:
883 rows carry `latest_reply`, 890 carry `thread_ts`, and the 7-row gap is exactly the 7 `thread_broadcast`
rows — a broadcast reply surfaces top-level carrying its PARENT's `thread_ts` and no `latest_reply`. Keying
on `thread_ts` invents 7 phantom threads per page.

**Completeness, in both directions.** A DELETED reply is detected — `reply_count`
moves while `latest_reply` does not — which a cursor-bounded poll structurally cannot see, since
`oldest=cursor` returns only newer rows. That is why the cursor file stores a count beside each cursor
(`{"version": 2, "threads": {"<channel>:<threadTs>": {"ts": ..., "replyCount": ...}}}`, migrated in place
from the old flat `key → ts` map). Against that, the oracle cannot see a thread whose PARENT was deleted,
because that thread has left history — so after every walk the crawl sweeps the stored cursors the walk did
not touch and polls those. That sweep is not optional, and it is bounded by what the walk missed rather than
by age: an age horizon would recreate the old-thread blind spot both this and
`src/live/listen/recoverThreads.ts` exist to close. An EDITED reply is missed by the oracle and was missed by
the poll too, so nothing regresses there.

**A large sweep says so, because silence is what made this expensive.** The sweep re-arms the per-channel
progress deadline on every poll — each one is genuine forward motion — so a big one never trips that watchdog
and the progress display's own `(stalled)` is the only thing printed. A sweep past
`SLACK_WIDE_SWEEP_THREADS` (`channelPages.ts`) therefore raises one warning naming the channel and the exact
call count, so a working crawl reads as working rather than being inferred from wall clock.

## 4. Bot-authored posts were suspected, and were never the problem

The three channels that looked like genuine gaps were all alert channels whose content is app-posted, so the
obvious hypothesis was that `subtype: bot_message` rows were being filtered out. Measured: they are not, and
never were. `shapeHistoryPage` drops only rows with no `ts`, and projection folds attachment and Block Kit
prose into the record text precisely because an app message routinely leaves `text` empty. All three were the
window floor in [§2](gaps-archived-and-cursors.md#2-one-pooled-cursor-could-not-express-never-crawled). Recorded here because the hypothesis is a natural one to have again.

## 5. Asking for every conversation class at once reached LESS than asking twice

Discovery asked `conversations.list` for `types: "public_channel,private_channel,mpim,im"` and the token
carried `mpim:read` and `mpim:history`, so group DMs looked in scope and had looked in scope for months.
They were not being returned at all.

Measured with the same token, same `exclude_archived: false`, same `limit: 200`, each walk paged to
exhaustion:

| `types`                                  | what came back                               |
| ---------------------------------------- | -------------------------------------------- |
| `public_channel,private_channel,mpim,im` | public, private and im rows, and **no mpim** |
| `mpim,im`                                | im rows and **mpim rows**                    |
| `mpim`                                   | **mpim rows** only                           |
| `private_channel,mpim`                   | private rows and **mpim rows**               |
| `public_channel,mpim`                    | public rows only, and **no mpim**            |

**`public_channel` present in the list suppresses every `mpim` row**, at every page, to exhaustion. Order in
the list makes no difference, and `im` survives the same combination. Nothing in this repository was
filtering them — `channelsFromPage` and `reachKind` read `is_mpim` correctly and had simply never been
handed one. So discovery now walks TWO lanes (`src/corpus/slack/lanes.ts`), the coverage report's `group-dm`
tally has a real denominator for the first time, and the structure lane asks a second time too, which is
what puts a group DM's MEMBER LIST — its audience — in the structure index.

The cap is applied PER LANE, and that is load-bearing rather than tidy: a budget shared across lanes is
spent by whichever walks first, so with hundreds of channels against dozens of group DMs any `maxItems` below the channel count would
return no group DM and report `capped` — an ending `cursorWalkWarning` deliberately does not warn about,
because the caller asked for a short read. The defect would have come straight back, silently, under a flag.

**Every budget in either lane is per lane, and `--slack-membership-cap` is the second one.** One budget
spent in discovery order puts hundreds of channels ahead of dozens of group DMs, so any cap below the channel count resolves membership
for exactly zero group DMs — the audience answer that lane exists to get, lost to a flag meant only to make
the run shorter. `planChannelMembership` takes the lane and is called once per lane, and its warning names the class rather than reporting one
undifferentiated count. Whenever a Slack read here grows a cap, ask which lane spends it.

The same pass gave the structure walk its own repeated-cursor guard, per lane. `conversations.list` carries
no `has_more`, so the cursor is the only termination signal there is; that walk had none, and a server-side
loop would have accumulated one page forever. It degrades to what it has plus a warning naming the lane and
the row count, rather than `err` as `live/slack/pagination.ts` does — a structure refresh that drops every
row is worse than one missing a tail, and a short walk that said nothing is the defect this section is about.

**`im` is deliberately not in the STRUCTURE lane.** A DM's membership is the token owner plus the one other
party every message in it already names; a group DM's is three to nine people and is not derivable that way.

**One measurement to distrust, stated because it cost weeks.** The finding that opened this counted `slack/G`
containers in bronze, found zero, and concluded group DMs were being dropped somewhere in projection. Group
DM ids in this workspace are **`C`-prefixed** (`C0SYN000026`, `is_mpim: true`), so that count could not have
found one even if every group DM had been ingested. `is_mpim` is the only signal; the id prefix never was.
