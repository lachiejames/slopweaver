# Which destination new Codex work takes

Bundled reference for the `plans` skill, split out of [register and routing](register-and-routing.md) so
each stays under the agent-doc cap. The register those rows come from is described there.

`slopweaver codex route` reads the register, asks every store's own `codex app-server` who is signed in and
what its limits read NOW (`src/codex/accountLive.ts`), falls back to its rollout log only where that is
unavailable (`src/codex/fleetRead.ts`), ranks (`src/codex/rank.ts`) and derives one report
(`src/codex/fleetAssessment.ts`) both the human lines and `--json` render, so the two cannot disagree.

**An SDK pass is admitted, then routed, when it is about to run.** `codex plan` asks the duplicate gate first and
routes only a pass it lets through; `codex review` does the same for EACH property when that property's slot in the
`--concurrency` fan-out opens (`src/cli/commands/codex/passRoute.ts`). A duplicate costs no fleet read and no
client, and a property queued behind others spends whatever ranks first when it starts — every property re-reads
the fleet, none inherits a route chosen before the fan-out. A property the fleet cannot take is refused alone,
its routing refusal printed, its siblings' artifacts kept, and the review exits non-zero. A routed pass is admitted
once more just before it runs, since the fleet read awaited and the checkout may have moved: a plan never runs a
HEAD its admission did not see.

**The order, and what each key is for.** Every eligible destination ranks in ONE pool — no reserve, every
registered row alike, because the owner wants every plan drawn down at an equal rate: a usable weekly reading before none, then the home whose week
sits furthest BELOW its own level line — the line an evenly drawn week reaches by now, 0 at the reset that
opened it to the pause bar at the one that closes it, judged NOW because a Codex reading is written only when a turn runs
there — then the lower weekly `used_percent`, then the same pair for the five-hour window, then the earliest
known weekly reset, then register order. A weekly reading with no usable reset has no line and ranks behind
every one that does. That first real key is the owner's desires for EVERY spawn (equal-rate
drawdown, never max one while another idles, nothing left on the table) and the owner's point that 80% resetting
in an hour is not 80% that reset an hour ago, measured as `claude/headroom.ts`'s `headroomToReset` measures
Claude: a home at 60% reopening in an hour is 38 points behind and takes the spawn from one at 5% a week out.
On two homes resetting together the 5% plan still goes before the 60% one. A Codex home belongs
to the session that booted against it, so there is no active slot to rotate and `codex route` is only ever
answering where NEW work goes. That is why there is no `codex rotate` and no `selectCodexAccount`.

**Three of Claude's keys have no Codex analogue and are deliberately absent**: Fable utilization, the
Fable-versus-plan-wide gap, and the measured 429 asymmetry setting `claude/loadBalance.ts`'s second key. What the two
providers DO share is the mechanic, extracted to `src/plans/rankKeys.ts`: a key is a tuple, applied in order,
never a weighted scalar — there is no measured exchange rate between a five-hour window and a weekly one.

**A destination pauses at about one percent left, never five.** A believable weekly or five-hour reading at
or past the register's Codex `pauseAtPercent` (99 by default; [thresholds](thresholds.md)),
whose reset is still ahead, excludes it as `near-cap` (`src/codex/routingCapacity.ts`) — the owner's steer: 1%
left is fine, 5% left strands quota. It is a ROUTING bar, not provider evidence, so an
all-near-cap fleet is unavailable but not capped — `codex status` prints no `CAPPED:` and the landing gates see
no cap — yet both fallback verbs stand in on it, the receipt naming the routing pause rather than a cap
(`src/codex/fleetCap.ts` `routingPause`). A window at 100% is the gauge's own positive cap evidence
(`codexHeadroom`), as it always was. `cmux spawn --force`
re-admits a near-cap or quota-refused destination, never a paused, signed-out, usage-limit or not-measured one.
Claude's routing bar (`routeAtPercent`, `claude/select.ts`) is its own field. `gaugeAlert.ts`'s card at
`alertAtPercent` (75 by default) excludes nothing.

**The owner's usage limit is lower than the bar, and nothing crosses it.** A row's `usageLimitPercent` (`plans
set-usage-limit`) lowers the WEEKLY bar to `min(pause bar, limit)` and the level line ends there, so a 30% row is
levelled against 30 rather than 99; a five-hour window, should a reading carry one again, keeps the pause bar. A weekly reading AT the limit excludes the
row as `usage-limit`, which is the owner's own number, not provider evidence: no `capEvidence`, and `--force`
cannot re-admit it. That holds for a limit set ABOVE a lowered bar too (90 on a bar of 80): `--force` crosses the
bar's undated or forceable pause, never the owner's 90 (`codexUsageLimitReached`). A `monthly-spend` row is excluded as `not-measured` before any reading is ranked, because
nothing here reads a monthly dollar meter. Precedence: paused, not-measured, signed-out, usage-limit, near-cap,
quota-refused.

**An SDK pass on a limited account RESERVES its share, so concurrent passes cannot cross the limit together.** A limit
the owner sets is respected even if it means taking the fleet down. A reading moves only when a turn writes one, so five review properties released together all read 48% of a
50% limit. Each `codex plan`/`codex review` pass and the `slack draft` comparison pass therefore routes through
`src/codex/passReservationStore.ts`: under the operation lock `codex-pass-reservations` (waiting up to 60s) it reads
the fleet again, reads `$SLOPWEAVER_HOME/live/codex-pass-reservations.json` (`0600`), and admits a limited ACCOUNT iff
`live used + reserved + 1 <= limit` — equality allowed, one point per pass. An account is every row the live read
joins by store, account id or address (`src/codex/accountIdentity.ts`), held to its LOWEST sub-100 limit and its
HIGHEST believable weekly reading, of which one must be live; a limited account no id or address proves is refused.
The ranking's order and exclusions are untouched — the gate only passes over a full account, saying why in the
routed or refused line. The pass releases in `finally`; a row a crashed pass left lapses at `acquiredAt + bound + 15
minutes`, never on a dead PID. A document that will not read or parse, a publish that fails, or a lock that does not
come holds every limited account out while an unlimited one may still take the pass. A fleet with no sub-100 row takes
no lock and writes nothing. Seats, `codex route`/`status`, the fallback verbs and the fleet-cap record read the
ordinary ranking: a reservation is not cap evidence.

**Refusing is its own fact.** A quota-refused destination is EXCLUDED: its own evidence says work cannot
proceed there.

**Nothing signed in is excluded, naming what to run.** A signed-out or missing store is excluded with its
`CODEX_HOME=<dir> codex login` line, which `codex status` also prints as an `ADVISORY` (the precedence above). An all-signed-out fleet is waiting on the
owner's sign-in, not capped. The skip is also CARDED: the fleet read files each store's live answer as a
`codex_sign_in_observation` row in the local store, and the `codex-plan-signed-out` monitor puts one top-of-queue card per plan up
on its next pass, with the login line on the owner's pasteboard (the owner's ruling: the fallback stays unasked,
the sign-in is the owner's). Unlike a cap, a sign-out never resets itself
([codex-plan-signed-out](../../monitor/reference/codex-plan-signed-out.md)).

**A cached address that disagrees with the live one says so.** When a row's `email` and its store's live
sign-in differ, `codex route` prints `ACCOUNT DRIFT … run slopweaver plans sync-accounts` under that
destination's one summary line, in the default read as well as `--full` (which adds who each store is signed in
as, its allowance, home and scan) — a plain
`codex login` in an existing home swaps its account without touching the register. `plans adopt` refuses on
an adopted register and names `sync-accounts` too, since re-adopting would refresh nothing.

**A live reading outranks every cached one.** Once a store's app-server reads a limit below 100%, it takes
work again with no `quota clear`. The gap: evidence with no `limitId` (a banner scrape, a rollout-log spend-cap
`task_complete`) names no window to supersede, so no healthy reading lifts it. `slopweaver codex quota clear --plan
<alias>` does: it records a clear instant, and cached or rollout-log evidence observed before it stops
refusing; a later cap, or one the live read reports, still refuses.

**A held free reset is the fleet's to redeem, and the chair's tick redeems it.** The fleet takes a plan all
the way up to 99 percent and then does the reset itself. Every tick runs `slopweaver codex reset --at-limit`:
each unpaused plan at its limit that holds a reset is claimed once per account with the soonest-expiring one, through
the provider's own `account/rateLimitResetCredit/consume` — no browser. `--plan <alias>` is the same claim on one
plan. "At its limit" is the routing bar above: a WINDOW at the register's `pauseAtPercent` whose reset is still ahead, the bar journalled with each reading — a depleted credit
balance is not one (hatch `SLOPWEAVER_ALLOW_EARLY_CODEX_RESET`). Both forms hold one home-wide lock, so a tick and a
hand run never claim twice, and `--plan` waits (exit 4) while any other plan's attempt is open, since it cannot see
whether that plan shares its account; for the same reason `--at-limit` sends no fresh claim while a plan whose
account it cannot read (paused, unregistered, or unreadable this pass) holds one, and names the `--plan` run that settles it. Each claim journals its idempotency key and the store as read BEFORE the call to
`$SLOPWEAVER_HOME/codex-reset/claims.jsonl`, and the answer with the store re-read AFTER it — windows, resets and
held credits both times, so a claim measures whether the week really restarted. A claim that leaves the plan at its
limit, or that the provider answers `nothingToReset`/`noCredit`, raises the one `codex-reset-failed` floating
note; a claim that refilled its plan says nothing. Before the call it journals the key, and a run that loses the
answer exits 4: re-run it and the SAME attempt, credit included, is settled rather than a second reset spent. An
open attempt the live read shows is over — no longer at a limit, or its reset gone — is closed, never
replayed, and the run that closes it sends nothing: that evidence is what a spent attempt leaves behind.

**Absent is NOT MEASURED and never sorts as zero.** With no live read, a home has a reading only once a turn
has run there. It is deferred behind every measured one and the ranking's `basis` says so (`weekly` /
`weekly-partial` / `weekly-unmeasured` / `no-eligible-destination`). Such a row may not say `0%` or
`healthy`, and only a live `account/read` may say `signed in` — nothing here reads `auth.json`. A reading
whose window already RESET is not measured either: its percentage describes the window that closed.

**A reading that says nothing never masks one that does.** Once a home is capped, every new rollout writes
only an empty `premium` reading — no windows, no reached type — so the newest dozen files once read as
"week unread" on a home at 100%. The gauge (`src/codex/gaugeScan.ts`) takes the newest INFORMATIVE reading,
walking every rollout modified within eight days of the newest (a weekly reading stays current for seven days,
and a resumed session appends to a file in an OLD day-directory, so the walk goes by mtime, never by name) to find
one, and falls back to the newest empty one only when none exists. A fresh
sign-in needs no further step either way: the live read ranks it at once.

**Every row appears, including the awkward ones.** A paused row prints the owner's own reason, a refusing row
prints its refusal, and an absent field is an explicit `null` rather than a key `JSON.stringify` dropped. A
spread is reported in percentage points with its sample count and never summed: two registered homes may be
signed into the same account, and two `limit_id`s are two different allowances. No threshold here calls a
fleet "balanced".

`src/codex/gaugeAlert.ts` reads ONE home by construction and says so; it names what closed on that
destination and points at `codex route` rather than claiming no other account can take the work.

## Either provider alone

One plan of either provider runs all of Slopweaver. Three consumers ask ONE decision,
`decideCodexSeat` (`src/codex/seatDecision.ts`): a `cmux spawn --driver codex` seat, the chair's Codex successor,
and the console voice. `talk offer` routes the call to the row a seat would take, sets that row's home as the
child's `CODEX_HOME`, and has no `--force`, so a paused, usage-limit or not-measured row never pays; a register
with no Codex row (a Claude-only install) refuses in one line, since the voice has no Claude transport. On a
REGISTERED register holding Codex rows and no Claude row, a `cmux spawn` that names no `--driver` boots Codex
(`src/cmux/driverDefault.ts`); every other register keeps the Claude default, a derived one included, since it
carries only the Claude plans the user signed in to. Still open: a chair seated on Codex never judges its own hand-off, because the
cadence reads Claude sessions only.
