# Scheduled recovery — reading a sweep's own report

Everything the loop has to DO with a sweep is in [SKILL.md](../SKILL.md) § "Scheduled recovery". This is how
to read what one prints, and the three readings that have each cost a session real time.

## Why the near-immediate `--deadline-ms` is the whole trick

It stops this becoming a second blocking loop alongside `--follow`. Scheduled recovery runs on its own
durable five-minute cadence, so most calls land before that cadence is due: the tiny deadline wins the
internal race first and the call returns almost instantly with `{"kind": "clock-wake", ...}`, meaning nothing
to do, go back to reading the stream. When the cadence genuinely IS due it runs a real sweep instead —
bounded and measured, well under a minute against this bot's own workspace — and returns
`{"kind": "recovery-sweep", "completeness": ..., "recovered": [...], ...}`.

## `completeness: "partial"` recovered nothing ON PURPOSE

Read its own `failures` for why: a channel this pass could not read completely. `excludedChannels` is a
different thing and never counts against completeness — it is the standing "the bot is not in this channel"
fact, and conflating the two once pinned the watermark for six days. `goneThreads` is the same idea one thread
down: a remembered root Slack answers `thread_not_found` for was deleted, so it is reported, retired (on a complete sweep, outside any excluded channel) from the
checkpoint inventory, and never counted either. A partial sweep advances no watermark.
Just note it; the next due sweep retries, and an hour of these under a live listener alerts.

## `threadCoverage` is not zero-backlog

A `complete` sweep means every attempted provider walk finished, never that every thread is caught up.
`threadCoverage.deferred > 0` means recovery's own thread inventory has threads still waiting their turn for
a bounded background poll — a genuinely `complete` sweep with real, reported backlog. Do not read `complete`
as "nothing left to check."

`deferred` is routinely in the thousands here and that is not a fault: **every root any sweep has ever seen
is in the inventory**, whether or not it had replies at the time, because a root nothing read is exactly the
one whose later reply would otherwise be unreachable (`src/live/listen/recoverThreads.ts#recoveryRootRegistrations` carries the trace). A sweep polls at most 25
of them.

**Nothing is ever dropped for age, but the rotation is not one queue.** Threads whose ROOT is inside seven
days take four fifths of each sweep's budget and the older tail takes the rest, with either lane's unspent
share spilling to the other and the tail keeping a floor of one whenever the budget is two or more — four
fifths rounds up to the WHOLE budget at four, which a busy sweep reaches. Seven days is measured — 122 of this install's 134 in-thread tags arrived
within it (`RECENT_ROOT_HORIZON_HOURS` carries the repro command). Before the lanes existed, 16,251
never-checked bootstrap seeds sat ahead of every already-checked thread in a single queue, so a thread
polled once was never polled again.

## `window.oldestExclusiveTs` is the PREVIOUS watermark, always — never this sweep's

This one has been misread as a regression twice, so it is worth stating flatly: the `window` a sweep prints
is computed from the durable watermark **as it stood before the sweep ran**, and the advance is written
**after**. So within a single report, `window.oldestExclusiveTs` sitting at some old instant is not evidence
of anything, however complete that same report says the sweep was. The advance is only observable in the
state file (`live/slack/recovery-sweep.json`'s `completedThroughTs`) or in the NEXT sweep's window.

Measured: a fresh loop's first sweep reported `completeness: "complete"` with
`oldestExclusiveTs 1787661513.652999` (about nineteen hours earlier) and was read as "the watermark has not advanced". It
had — that same pass wrote `completedThroughTs 1787730827.211000`. What was true is the thing the report
could not say on its own: **no complete sweep had run for the preceding nineteen hours**, so the window this
one opened with was nineteen hours wide. A wide window is the real hazard, and it is why an ask already in
flight has to be excluded by its LIFECYCLE rather than by its message's age — a recovered ask is captured
long after its message was sent, so no test on the message can tell the two apart.

**To check the watermark is actually moving, compare two consecutive sweeps' windows** (or read
`completedThroughTs` before and after) — never one report against itself.

## The lifecycle log is ONE witness; the thread is the other

MEASURED: an old thread was re-answered by the bot multiple times. The owner's own DM thread was answered and
corrected thirteen minutes later, and a fresh loop's boot recovery pass posted a THIRD reply 34 hours after that. Both real
answers had gone out through the `slopweaver slack post`/`reply` BOT-CARD lane rather than through `turn
answer`, so they carried no `askIdentity` on the wire AND appended no `answered` row. Every lifecycle
exclusion was silent, `already-answered` had nothing to match, and the ask read as a clean dropped tag.

So a sweep asks BOTH questions, and reports them as two exclusions rather than one, because the claims
are not equally strong:

- **`already-answered`** — a reply's own metadata names exactly this ask. What the install wrote down.
- **`answered-in-thread`** — this install already posted a bot CARD inside this ask's own stretch of the
  thread. What Slack still SHOWS. The stretch runs from the ask's own `ts` to the first later message that
  itself tags the bot, so a card answering an earlier ask can never be read as answering a later one.

`src/live/listen/answeredInThread.ts` carries the four `metadata.event_type` families this turns on (the
stranded lane's own re-dispatch notice carries `slopweaver_notice_v1`, never an answer) and the one case
still invisible to it: an answer hand-posted under the owner's OWN identity carries no Slopweaver
metadata at all. The durable fix for that is upstream — a hand-composed answer should append its own
`answered` row.

Two limits go with it, both stated in that module rather than discovered later. An answer hand-posted under
the owner's OWN identity carries no Slopweaver metadata at all and is invisible here. And the card lane
stamps ONE event type on everything it sends, so a non-answer card dropped into a thread holding an
unanswered ask reads as an answer and that ask stops being recovered — bounded, because the live listener is
untouched and a fresh tag still wakes a session, and visible, because the card's `ts` is in the report. Both
have the same durable fix upstream: the card lane should append its own `answered` row.

The sentence above about excluding an in-flight ask by its LIFECYCLE rather than by its message's age still
holds; what this adds is that the lifecycle log being silent is not the same as the ask being unanswered.

## The manual pass is a different verb

This is the loop's own AUTOMATIC recovery. The manual, on-demand `listen recover` pass in SKILL.md stays for
a deliberately WIDENED one-off catch-up the owner asks for by name — and it widens with
`--discover-channels`, which ADDS the bot's own membership to what you typed, never by typing more:
[edge-cases.md § Dropped tags](edge-cases.md#dropped-tags--the-widened-manual-pass-deliberate-never-on-a-timer)
has it, and its coverage read.

**Where the two modes part company: what an unreadable channel MEANS.** Here, discovery walks the bot's own
membership, so `not_in_channel` names a channel that was never in scope — it is reported in
`excludedChannels` and deliberately does NOT make the sweep partial, because counting it pinned
`completedThroughTs` for six days. A manual pass is the opposite whatever chose its breadth —
typed into `--channels` or walked by `--discover-channels` — because it has no watermark for that count to
pin: a channel it could not open was one it set out to read, so the pass goes `partial` and exits `1`. Same
classifier (`permanentExclusion`), opposite completeness verdicts, and the cost of the stricter one is a
re-run rather than six days of silence.

## A stranded ask arrives in the same `recovered` list, and you treat it identically

A sweep now recovers two kinds of survivor: a tag that was **dropped** (the listener never saw it) and a tag
that was **stranded** — worked and ended with no answer, at `failed`, `dispatch-failed` or `lease-expired`.
The second is the owner's ruling reaching the loop: the owner will not re-tag the bot to get it going, so
a session the owner can SEE picks each stranded ask up **exactly once**, tells the thread it is doing so, and spends
that ask's one re-dispatch as a durable `redispatched` event. Nothing here is a daemon, a queue consumer or a
retry: the pick-up happens inside the pass **you** run, and with no session running there is no pass and the
ask stays stranded behind the failure card it already has.

**There is nothing new for you to do.** A stranded survivor lands in the same `recovered` array with the same
`EmittedMention` shape, so it goes through the same three steps every other survivor does. What it will look
like: the thread already carries a failure card from the first attempt, a one-line `Picking this back up —
…` notice above your fresh `:eyes:` and card, and — very often — an ask that is hours rather than minutes
old. Answer it anyway; a day-long staleness bound already threw out anything genuinely stale
(`src/live/listen/stranded.ts` carries the measurement).

**One stranded shape already has an answer in its thread: a plan.** A worker that posted a first answer
declaring `followThrough` and then vanished is stranded too, its notice reads `Picking this back up — the
plan above was posted, but the session building it …`, and its plan's own answer metadata does not exclude it
as answered (only a SECOND exact answer does). The re-dispatched worker's brief opens `FIRST ANSWER ALREADY
POSTED`: build what the plan promised and post the FINAL answer, never a second plan.

Two lines on stderr are the lane narrating itself, and both are reports rather than instructions:

- **`re-dispatching a stranded ask: <channel>/<ts> — <state> for Nm`** — its one attempt was just spent, and
  its verdict is in this sweep's `recovered`.
- **`stranded, not picked up: <channel>/<ts> — <why>`** — nothing was spent and the next pass tries again.
  A repeated `could not read its thread` is worth surfacing per rule 6; the rest (a channel the bot may not
  answer in, an ask deliberately ignored, a message that has left the thread) are correct refusals.
- **`recovery skipped: <channel>/<ts> — IN REVIEW …`** / **`— BUILDING …`** — never a strand, so nothing was
  spent. BUILDING is a `lease-expired` ask whose plan stands and whose recorded worker's workspace cmux still
  calls alive, or cannot decide (`liveBuilderHolds`, `src/live/listen/stranded.ts`): a re-dispatch beside it
  would be a second build of the same stack. Liveness, never the screen — a Codex screen never reads busy and
  a builder waiting on a backgrounded wait reads idle. Gone or unrecorded lets it through, so a builder that
  stopped is picked up once its workspace closes — inside the day-long staleness bound only. Nothing closes a
  stopped builder's workspace for you, so a repeated BUILDING line over an idle workspace is yours to surface
  (rule 6) before the ask ages out behind its card.
