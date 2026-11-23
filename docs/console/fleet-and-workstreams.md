# `content/console/fleet.mdx` — what the fleet did, is doing, and will land next

Part of [The console, the board, and the session ledger](../console.md).

The page is the sidebar's Fleet entry, fifth of its pages; the Queue carries no seats line, because a count of
running seats beside the owner's own rows is noise. One switch picks Past, Now (the default) or
Next, kept in the address as `?view=` (`site/components/live/Fleet.tsx`). Most of this section is Now.

**Next opens on what the owner would wake up to**: something useful that gives a good idea of what the fleet will be
working on over the next few hours or days, with progressive disclosure, very readable, every element something the
owner would want. The tile `site/components/live/FleetForecast.tsx` draws
`site/lib/fleetForecast.ts`: one sentence giving how many rows the measured pace reaches in the next 12 hours; four
figures (that count, the ready rows nobody is on, how long they last at the pace if nothing new arrives, what waits
on the owner); the rows themselves one line each — the rows a live seat is placed on first, then the top of Next up — each
with the owner's words behind its fold; and the rows parked on the owner (`ownerWait` set to the owner) behind one more fold. The pace is the
DONE rows whose `movedIso` falls in the trailing 72 hours, divided by 72: three days because the board sweeps a
settled row away after about that long, and `movedIso` is when a run journal last moved, not a landing time. It is a
pace carried forward, never an estimate of one row. No settle in the window is said as no pace, never a zero; a
reconcile reading still loading or refused costs the rows and the runway, never the pace, because the tile stands
on the board. Under it come Next up (the board's ranked ready rows minus the seated ones, `nextUpOf`) and the owner's
steers, in that order.

**The order of each list is said here, never on the page** (no page carries a method fold,
[work-console.md](work-console.md)). Likeliest to land and the owner's queued steers are in the order the fleet takes them;
Next up is in the board's order, highest first; Past's settled rows are by when their run last moved, newest first.

One tile, **Agents**, and one line of machine health under it. Anything needing the owner stays on the queue; this
page holds no control that answers it. The tile joins two readings the supervisor tick records under one `by` —
`session watch --json-report` (every open seat and its `signal`) and `handover reconcile --json` (which
row each seat is placed on, and that row's `standing`) — in the pure `site/lib/nowSeats.ts`, which the state band
judges by. No seat is "asked you", because a parked session leaves the owner's fleet immediately: `session close-done` closes a parked seat with its checkpoint on the
row, so a row waiting on the owner is the queue's to show; a row parked on CI or a clock is counted in the state band, never a card. A stopped seat's place is never derived from `needs-input`: that signal fires
on any `Notification` hook, including a turn that merely went idle, and MEASURED on one tick
15 seats read `needs-input` while 5 sat on a row parked on the owner. A join that cannot be trusted — no board reading,
another tick's (or one whose instant cannot be read), a fleet not observed, a seat placed twice, a standing missing
(an old reading) or one the page does not know — is refused whole: the tile names why and judges by the signal
alone.

**The sessions under the state are the working ones only**, one Queue-style card each: `site/lib/workingSessions.ts` (`workingSessionsOf`) keeps the seats whose `signal` is `working`, in the
reading's order with the supervisor first. A card is identical to the queue cards except for the
contents: ONE short plain title — `Supervisor` for the pinned supervisor, else the
session's own `sessionTitle` (Claude Code's newest `ai-title`, read off the transcript tail by `session watch`'s
`withSessionTitles` for the `--json-report` document only), else its cmux title — each with the terminal glyph
dropped (`plainTitle`, refusing any one-token title as a slug, a slash command, and a second sentence or line) — else the first clause of its trusted placement's `row.label` when 90 characters or fewer
(`firstClause`), else `outcome not read`. The supervisor is `session watch`'s own `manager` flag,
`isPinnedSupervisorWorkspace` (`src/cmux/supervisorWorkspace.ts`): pinned AND titled `/slopweaver:supervisor`, never
a title match on the page. A card carries the Queue card's anatomy (`site/components/live/WorkingSessions.tsx`, on
`QUEUE_ROW`): a 3px stripe and glyph — the supervisor a crown on a primary tint — a number badge, then the host, its
board row's priority (its placement's row, else the ONE board row whose slug its spawn worktree's
directory is named for — never a bare basename, which a main checkout or reused worktree can match by
coincidence, `rowOf`) and a
liveness badge, `active 4m ago` or `quiet 2.5h` from ten minutes (`livenessOf`). Opening it puts `SessionTurnView` in
`SLIDE_BODY_SESSION` (`SlideOver.tsx`), four fifths transcript and a sticky fifth of `sessionPropertiesOf` plus the
goal — the latest turn's opening prompt, off the same read. The transcript opens by `session watch`'s `sessionId`
(the hook payload's own) with cmux's `claude-` prefix stripped (`transcriptIdOf`), never by a `cwd` join, and is read once:
`SessionTurnView` has no timer. Phase and review rounds are `not read` by construction (`SessionPhase`): a completed
Codex pass proves only that it completed, so no live phase or round count is inferred from one. `session watch`
publishes `sessionId`, `sessionTitle`, `lastActivityAtIso`, `openedAtIso` (each instant canonical, or absent when
cmux stamped the event `unknown`) and `manager` on every row; a reading recorded before them reads each as not read — so it pins no supervisor, since the
page never guesses one by title — and a malformed one refuses the reading (`readNow.ts`). The open panel's transcript
is keyed by session id, so a workspace that moves to another session redraws rather than showing the old one's.
A read whose view unmounts is aborted in the browser; the route does not pass that on, so in development React's
Strict Mode still runs the spawned `transcripts last-turn` twice for one opening, while a production build opens
once. The health line is the listener's `grade` and `machine capacity`'s
HOLD, ALERT or clear with its load, one line drawn by `site/components/live/MachineHealth.tsx`. Readers live in `site/components/live/readNow.ts` and `readNowCapacity.ts`, same refuse-never-substitute
contract as `read.ts`.

**Why it reads the ledger and never the verb.** The verb is a cursor DRAIN — it reads the cmux events after
its stored cursor and advances it (the `session-watch` row of `cmux_event_state`) — so a page draining it on a timer would starve
the supervisor tick's own drain of the events it judges. So the rows come from the tick's own gauges, which `supervisor tick-capture` records as readings —
`machine capacity`'s exit-1 document included, so the page never reasons about a diagnostic exit. The
route's not-JSON reason says what the verb DID print — "nothing at all", or the first 120 characters —
because "not json" alone hid the runs that printed nothing on exit 0 — the shape of cmux hanging up mid-replay, which the drain now resumes past (`src/cmux/resumingDrain.ts`).
The board half has a cost of its own: `handover reconcile --json` walks the whole board, every live cmux workspace
and the owner's transcripts (8.6s wall on this machine, `time slopweaver handover reconcile --json`), so polling
it would pay the tick's cost a second time and read a different instant than the tick did. `readingOf` and the
`Reading<T>` envelope (`components/live/reading.ts`) narrow every recorded document a page reads.

**The state band** sits above the counts and answers whether the fleet is capacity-maxed and on the owner's steers
(at any given time the owner can look at the fleet and feel confident it is capacity maxed and alignment maxed). It
reads in four parts:

- **A state badge** — `at capacity`, `picking up more`, `holding: machine busy`, `holding: nothing ready`,
  `holding: plans won't take another session`, `holding: at the week's pace` or `not measured`.
- **The working count in bold, then one sentence per line**: what holds, each reason with its figure, and what
  releases it. Never one line joined on dashes; `app-copy-voice` holds
  the dash half of that for the whole app.
- **What the working count leaves out**: the rows whose seat parked on a clock or another branch's CI (`handover park
--wake-at` or `--wake-on-checks`; a seat landing its own pull request keeps its seat and counts as working) and closed, off the `parked.wake` each board row publishes, so a count of working seats never reads lower than the seats doing work. One line says how many and on what, one when the next clock wake is, and
  each row with what it waits on sits behind a closed `what each waits on` fold (`site/lib/parkedWaits.ts`,
  `site/components/live/readParkedWake.ts`). A wake that will not read is counted and said; a fixture page, whose
  seats never join the live board, says it was not read. They change no verdict and are no session.
  The CI parks are split by what the tick's last `handover wake --json` found of each pull request (checks still
  running, open with none still running, merged, closed unmerged), aged by the instant that wake judged its rows (the report's own `observedAtIso`, never the ledger's later record stamp), because the board alone cannot tell an
  open pull request from a merged one (MEASURED: 57 "on CI" against about 20 open). Each park is joined on its
  slug and journal `parkIndex`, both producers publishing it, with its instant and pull request held equal too. A
  park that matches nothing, or more than once, reads "not measured", and a wake document with one row that does
  not read (a clock row included), or whose instants are out of order (any park after the wake that judged it, a
  wake after the ledger stamped it), or that names one park twice, is refused whole
  (`site/components/live/readWakeReading.ts`). The board is read once, so a park the wake's journal says is gone once
  that wake was done (each row's `parkStanding`, never its action: a failed spawn may have cleared its park or left
  it) is said on its own line as no longer parked, never counted as parked or due; a row whose journal would not
  re-read says `unknown`, and refuses the reading. A refresh that fails keeps the last split on the page beside the stale mark.
- **The defence**, shaped like a Queue card's quote block: the figures with their measurement window, the three
  heaviest processes by cpu and by memory on a machine hold, and whether a load investigation is running — when it
  started and which working session has it — with the rest folded. Cpu is a one-second sample, and the heaviest
  processes are what the machine was running at the reading, not proof any one of them is the cause; the page does
  not say so (no page carries a note on how it is derived), this doc does.
- **What binds, and what the machine measured** — the `fleet why` sentences, described below.
- **A closed history** of the last day's states, each run of supervisor ticks in one state for one cause.

The verdict is `site/lib/fleetGlance.ts`'s (`fleetGlanceOf`, and `fleetVerdictOf` for a past tick); the badge,
sentence and defence are `site/lib/fleetState.ts`'s; the spans are `site/lib/fleetHistory.ts`'s, judged by the same
verdict over `fleet history --json` on the `fleet-history` row. All of it reads what the tick already records — the
plans' ceilings and the dispatch investigations inside `machine capacity`, and `fleet ceiling` on the
`ceiling-reading` row — so the supervisor fills no field and no sentence on the band is hand-written. Room under the
ceiling with the board unread is not measured, never "picking up more", in the badge and the history alike; a history
tick recorded before the open-ready count existed carries none, so it reads that way. The badge reads live and a tick lands
once a sweep, so `site/components/live/HistoryFold.tsx` names its newest tick and says when the badge has read past it.
The burst rule is stated in `fleetGlance.ts`'s header so the owner can disagree with it. Under the defence, one closed line
for Claude and one for Codex (`site/lib/planMeters.ts`, `fleetUsageOf`) gives each host's week left averaged across
its plans that take work, its running sessions and its 24-hour burn (`fleet burn` on the `burn-reading` row).
Opening a line lists its plans by alias, the account on hover, with three bars each.

Under the defence and above the history, **why the fleet is not running more** (why it is not
spinning more right now, and what it measured over the last minutes): the `fleet why` sentences off the
`why-reading` row, drawn when it judged the very capacity reading the verdict did (its `current.tick` and
`current.machineObservedAtIso`, since a tick label alone can be reused), or came from a newer tick whose binding it
judged `unknown`, whose sentences then say why that tick cannot be judged (`whyOfTick`).
What binds now (the plans' ceiling, the machine hold, both or neither) stays in the open, and what the tick's
sampled `machine capacity` readings measured over the last hour, plus where the cpu went, is folded behind
"what the machine measured". `src/capacity/fleetWhyRender.ts` writes every sentence, for the page and the verb
alike, so the page composes none.

**The Machine tile opens Now, read live every two seconds** (two-second
updates of CPU, memory and sessions, each reading's age shown, charts moved to Past). Its header stamps the reading's
age: green and "read 2s ago · every 2s" up to ten seconds, amber past ten, and past a minute "stopped updating" with the
last failure's reason (`site/lib/liveMachineClient.ts`). Under it one verdict line judges the machine half of whether
the fleet may take another session on that same reading, by the supervisor's own thresholds (load at `floor(3 x
cores)` only under 20% idle, compressor segments at 40%, twelve swapfiles), then four meters, each a figure out of its
total: CPU busy split fleet and everything else, memory in use split the same way, load against its hold, and live
sessions counted from the processes rather than cmux. A meter names the heaviest outside process only where it
outweighs the whole fleet. Then the live sessions, heaviest cpu first, five and "and N more", each titled from the
working-session card with its transcript id and opening that card's panel. The read is the console server's own
(`site/lib/liveMachineRead.ts` behind `/api/live-machine`): `ps` twice, `vm_stat` and `sysctl`, about a third of a
second at load 20, coalesced to one read a second however many tabs ask, and outside `useLive`'s read slots so the
slower `slopweaver` children never starve it. CPU is the difference between two `os.cpus()` snapshots, never against
one over ten seconds old: a read with no fresh baseline takes two a second apart, so a tab opening after every other
closed draws an interval of seconds rather than an average over the hours nobody looked. A process the
baseline lacks started inside the interval, so its whole CPU time is the interval's. A hidden tab takes its first
read and then nothing more, and its stamp ages to say so. The plan
usage block below keeps the supervisor's capacity reading and says how old it is, "read X ago · by the supervisor".
Every threshold and parser the page restates is bound to its `src/` original by `liveMachineMirror.test.ts`. Code:
`site/lib/liveMachine*.ts`, `site/lib/liveSessionArgv.ts`, `site/components/live/LiveMachine.tsx`, `NowLiveMachine.tsx`, `useLiveMachine.ts`.

**The machine charts** open Past, as "The machine, last hour": believable cpu
and memory over time, Activity Monitor style, the hold and when it started on the chart, the fleet split from
everything else with the biggest others named. Three small charts over the last hour, off `machine series --json`
on the fast `machine-series` row: cpu in cores as the fleet's band under everything else's, the 1-minute load
against the dashed hold line with a marker where a current hold began (or, past an unsampled gap, where it was
first seen, said as "since at least"), and memory in use with the compressor and
swap in words. Memory in use is Activity Monitor's sum off `vm_stat` (app memory, wired and compressed, the
purgeable file cache left out) against `os.totalmem()`, because `top`'s PhysMem counts the file cache: one reading was
47.0 of 47.1 GB while Activity Monitor's sum was 44.7 (`vm_stat` beside `top -l 1 | grep PhysMem`). The fleet is every process
under a Claude Code session root, cmux or a slopweaver worktree, children included, because cmux's own cpu leaves
its children out; everything else is grouped by its command's name, never its argv. A sample is one `top` taken at
most every thirty seconds on the page's twenty-second poll, which Now keeps asking for without drawing it so Past
opens on the hour, so while either view is open the newest is under a minute old (the bound is five minutes), and a stretch of over four sample gaps (two minutes) with no
page open is drawn as a gap rather than a line across it; the page says that bound in words. The line under the
heading states the newest sample's age. Code: `src/live/machine/series*.ts`, `site/lib/machineSeries.ts`, `site/components/live/MachineCharts*.tsx`.

Fixture mode freezes the seats and the health line to captures taken within half an hour of each other and
recorded into a throwaway home. No reconcile capture is committed, so a fixture page shows the signal-only
fallback and says the board was not joined — the fallback working, not a gap in the capture.

## `content/console/workstreams.mdx` — how far each of the owner's outcomes is from the loop closed

The owner's outcomes, one collapsed card each, read from `slopweaver workstreams list --json` on the fast lane: one store read
of the register, schema version 2. Every card's lane, progress and graph, and the page order (at risk first, then
the owner's priority), are the verb's `derived` block (`src/workstreams/store/projection.ts`, lanes and order in
`src/workstreams/lanes.ts`), and
`site/lib/workstreamTiles.ts` only narrows the document — refusing it whole when a known kind will not read or the
version is not 2, and counting a kind it does not draw rather than dropping it silently. `site/lib/workstreamFilter.ts` is what the
page shows of it: the context's half by each row's stated `workspace`, the key-value filters addressed in the
query (`state`, `priority`, `initiative`, `tag`), and the hero numbers counted over the context's half, because
the verb has no context. **A meter fills to the share of the workstream's OWN milestones done**, beside the verb's
progress line (`2 of 3 done, next: Rolled out`); a milestone is done only by a dated entry carrying its proof, and
the last one is its definition of done. There is no generic bar, no phase and no last-stretch zone. A linked one's
meter is its gauge. The page's grouping is the register document's own `grouping` (its label, why, what it was
built from and its anchor), and a register with no document draws its rows with no grouping. Each card is a button in one vertical list — the lane chip, title, meter and stats —
opening the shared `SlideOver` at `?open=<id>` (filters kept, unlike the Queue's `panelHref`), which holds the meter,
the milestone graph and the dated story, every source a citation chip, its Slack places named off the register's `channels`
(`namedSlackPlace`, `site/lib/citationPlaces.ts`; an unnamed one reads `a message`, never an id). The side
column draws `people` as `PersonChip`s off the `people` roster the verb joins under `--json`, each `workstream` link as
a button opening that one's slide-over, and every other link kind (a Queue or alignment card, an automation, a pull
request, a Linear project) as a chip. An empty store (no workstream, no register document) is the verb's exit 3, `NO_WORKSTREAMS`, which the
allowlist row declares as its expected-empty answer: `site/lib/workstreamsReading.ts` reads it as its own absent
arm, so the page draws its designed empty state — a workstream appears when the owner keeps one of the proposals above,
the owner's stated outcomes among them, never a command to run — the sidebar badge a measured 0 and the Queue no
priorities gap, never a staleness mark (five warnings make everything look and feel very broken). Any other exit stays a failed
read, marked as one. The register is the ONE source of the
owner's outcomes (one way of doing things): the proposals above the cards are the stated outcomes,
built in, then the mined ones, read from `workstreams candidates --json`, which always answers — `mined: null`
before any mine, `provenanceLine` (`site/lib/workstreamCandidatesPage.ts`) saying so. Why it is not the board:
[workstreams.md](../workstreams.md#the-owners-outcomes-are-a-different-register-and-a-narrow-one).

A board row has no page of its own, so a citation naming one — a typed board row, or the older
`/workstreams?row=<slug>` address a transcript carries — draws as the row's words and opens nothing
(`site/lib/citationDisplay.ts`).
