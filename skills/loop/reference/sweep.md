# Sweep — reaping fresh sessions and expired leases

`turn dispatch --sweep` is the ONLY channel through which a dispatched worker's fate reaches the listener.
Run it at the start of the loop, on every idle tick, and right after dispatching or finishing any turn. It
relaunches nothing.

## Reading turns that are already OVER — `turn ledger`, not the sweep

The sweep reads OPEN dispatches, so it is silent about every turn that finished. `slopweaver turn ledger`
answers how long a day of turns actually took — the join of the ask-lifecycle log, the completion ledger,
each ask's validated drafts and each review round, as a verb:

```bash
slopweaver turn ledger --since <iso>                           # one row per ask, newest first
slopweaver turn ledger --since <iso> --channel <id> --json     # every phase in exact seconds
```

One row per ask carries the five spans of its turn — the tag's own instant to `captured`, `captured` to the
first dispatch, the last dispatch to the first validated draft, that dispatch's first review round to the
terminal event, and tag-to-answer whole — plus the rounds and their verdicts, and a mean/median footer under
them. Read-only and diagnostic: no door, no write, no model. A RE-DISPATCHED ask is marked `re-dispatched
xN`, measured from the FIRST dispatch for spin-up and the LAST for the two inside one generation, and left
out of those two averages only — never out of the page. A span whose closing instant is EARLIER than its
opening one reads `reversed`, never a negative number — two of the five open on Slack's clock and close on
this machine's — and is in no average; a dash is the different case of a record set that was silent. It
reports no reaction to the answer because nothing on this machine records one yet, and the footer says so
rather than printing an empty column.

## `turn blocked --json` rides the same cadence, and it is not part of the sweep

`turn dispatch --sweep` reports what a WORKER is doing. A turn waiting on the owner has no worker — its
session stood down and gave back its lease and the listener token — so it never appears
there, by construction. `slopweaver turn blocked --json` is the second read, and two standings come back:

- **`waiting`** — a step needs the owner and the owner has not done it yet. **Not yours to touch.** No chase,
  no clock, no re-tag, and never a second card in the thread. It reaches the owner through the fleet briefing's react-now
  block, which `briefing check` refuses a page for omitting.
- **`ready-to-resume`** — the owner has done it and a visible session owes this turn one re-dispatch. Run the
  `resumeCommand` the row prints (a `turn dispatch` over the SAME brief), then finish the turn normally over
  the card it already has. Never re-capture it: a fresh capture posts a second card over the one the
  hourglass has been standing on, and the trail the owner reads these cards for is what gets lost.

A `ready-to-resume` row leaves the list on its own once you dispatch it — the `dispatched` event supersedes
the `unblocked` one — so nothing has to remember to clear it. The whole state, its rails and its verbs are in
[../../loop-bot/reference/blocked-on-human.md](../../loop-bot/reference/blocked-on-human.md).

## The two loudest readings, and they print FIRST

`UNROUTED` and `NEVER-DISPATCHED` lead every sweep, before any healthy finding, and the summary line leads
with them whenever either fired. Both mean the same thing about the channel — a card is standing under a tag
and no session is behind it — and both end in the exact `turn brief` command that starts the routing. **Run
it.** Do not wait for a recovery pass: `listen recover --scheduled` picks a stranded ask up by CAPTURING it
again, which posts a SECOND card over the one the person is already watching, and `turn brief` recovers the
standing card (and the question) from the ledger so you do not have to.

- **`UNROUTED — ROUTE IT NOW: … — captured Nm ago`** — the ask has no dispatch and is still inside the
  thirty minutes the sweep gives a session to route one. **Nothing has been settled**; the card is telling
  the truth and you are the session it is waiting on. Without it, an ask carded in a public channel
  read as a clean board on every sweep for the next 33 minutes. **An ask YOU are mid-brief on appears here too, at `0m`** —
  the finding is "captured, no routing decision recorded", and between `turn brief` and `turn dispatch` that
  is literally true. Recognise your own current work and carry on; the row leaves on its own the moment you
  dispatch. Reporting it is the deliberate trade for never missing one that is nobody's.
- **`NEVER-DISPATCHED — ROUTE IT NOW: …`** — the same ask, past that bound. The sweep HAS finalised it: the
  card is marked abandoned, the reaction converged, and the ask is left stranded
  with one re-dispatch pending. Take it here rather than leaving it for the stranded lane, for the
  second-card reason above.

## The third reading of an unrouted ask, and it says DO NOT ROUTE

- **`IN REVIEW — DO NOT ROUTE: … — last event Nm ago and no dispatch was ever recorded, but <why>`** — the
  ask has no dispatch AND an open review, so a session is inside the turn right now. **Nothing has been
  settled and nothing is owed to you**: no event, no indicator, no reviewer reaped. It carries no command,
  because both instructions above are wrong about it — re-briefing posts a second card over a live turn, and
  the reviewer it names must never be messaged. It is the healthy reading of this shape: the turn is being
  worked, and the thirty-minute bound is HELD.

  It exists because an INLINE turn records a `dispatched` row only when `turn dispatch` runs, and a turn
  composed in-session and reviewed straight off its brief and decision files never reaches that verb — so
  nothing on disk says it is routed until `turn answer`. Measured: an owner-ack turn was carded,
  printed `UNROUTED — ROUTE IT NOW` on every lap while a session worked it, and was finalised
  as never-dispatched 33 minutes later with its round-1 reviewer mid-verdict. Its answer posted 15 minutes after that.

  The hold is capped by the same `MAX_REVIEW_HOLD_HOURS` `lease-held` uses, so a reviewer that never returns
  cannot keep a card standing forever — past the cap the ask goes `NEVER-DISPATCHED` normally. **The window
  it does NOT cover** is from `checklist-posted` until the review opens: in that window an inline turn still
  shows as `UNROUTED`, exactly as your own mid-brief work does, and the guidance is the same — recognise it
  and carry on.

## What each reading means

- **`still working: … — worker <name> (<ref>); reviewer <name> (<ref>)`** — CHECKED against cmux now, never bare
  `working`. Both are NAMED as `ListAgents` shows them: address one by name, never by start time, and **never
  interrupt a reviewer mid-verdict**. The sweep also pushes the worker's screen detail to the checklist.
- **`ready: … — <answerPath>`** — the worker validated its answer and is between review and send. Normally
  momentary, since the worker posts itself. A trailing `ready and unposted for Nm` means it stalled there, most
  likely a reviewer that never returned. Look at its workspace; if a verdict exists you MAY carry the answer with
  `turn answer --dispatch <id> --verdict <path>`, otherwise surface it per rule 6. Never post an unreviewed one.
  **A permanently ignored ask never reaches this reading**, so every `ready:` line is a real invitation —
  see `ignored (not swept)` below.
- **`ignored (not swept): … — <which registry> … ; lift it with <the remove command>`** — a permanent ignore
  registry answered for this ask before the sweep judged anything, so **nothing here is yours to do**: do not
  carry an answer, re-judge, or post to its thread. `turn ignore` appends no terminal lifecycle event, so
  such an ask kept its dispatch and was read `ready` — with an answer path long since reaped — every ten
  minutes for six days (measured, `src/live/turn/sweepIgnored.ts`). The whole ask is excluded,
  not just its `ready` reading, because three of the sweep's arms are outbound WRITES. It stays named on
  every tick rather than disappearing, for the one residue: a worker still holding an ask ignored mid-turn
  is not reaped, so its workspace is yours to close by hand. Counted as `N ignored` in the closing line.
- **`worker-failed (finalised, stranded — one re-dispatch pending)`** — the worker reported it could not
  answer, in its own words. The sweep has ALREADY finalised the thread from that report: card marked failed
  with the reason, reaction converged. Nothing to redo here, and **nobody re-tags**: the
  ask is now stranded, and the next scheduled-recovery pass you run picks it up once
  ([reference/scheduled-recovery.md](scheduled-recovery.md)).
- **`phantom`** — its recorded workspace holds no session, and **never hunt one by DIRECTORY**: no per-ask
  worktree or run journal ever existed (`src/cmux/liveness.ts`). Like the two above it, the ask is stranded
  and the recovery pass picks it up once — you do not re-dispatch it by hand.
- **`phantom … after its first answer <ts>`** — the worker posted its plan (`first-answered`, declared by
  `followThrough`) and its workspace is gone before the build finished. Something RAN, so it is recorded
  `failed`, never `dispatch-failed`; the card says the plan above stands, and the recovery pass's notice says
  so too. Two readings never reach this ask after a plan: a `ready` marker recorded BEFORE the plan (that was
  the plan's own validation, not the build's), and a `lease-held` from the plan's own clean verdict (spent by
  the post) — either would hide a dead builder.
- **`lease-expired`** — a re-judgement candidate; the sweep finalised the card as abandoned. Stranded too.
  After a first answer the lease is RE-ARMED at the plan for one more `DEFAULT_LEASE_HOURS`, and a builder
  cmux reports alive past that reads `still working` for up to `MAX_REVIEW_HOLD_HOURS` more; the line then
  reads `lease-expired (re-judgement candidate, first answer posted <ts>)`. The recovery pass still will not
  re-dispatch it while that builder's workspace is alive (its `BUILDING` line, [scheduled-recovery](scheduled-recovery.md)).
- **`lease-held`** — past its lease and NOT finalised, because ending it would discard work that is done or
  nearly done. Two cases, and the line says which: a `clean` verdict bound to this exact answer already
  exists, so the answer is postable and the clock has nothing left to end; or an independent reviewer is
  mid-verdict, and its time is not the worker's to pay for. The hold is capped, so a wedged reviewer cannot
  postpone the sweep forever and the ask expires normally once the cap lapses. Measured: an ask
  ran five honest review rounds and was finalised two minutes inside its own lease with a reviewed answer in
  hand, which the owner then had to rescue by hand. See `src/live/turn/leaseJudgement.ts`.
- **`dispatch-witnessed (reconciled)`** — an unwitnessed pickup is corroborated; until then it reports `still working` and is never resent ([docs/pickup-witness.md](../../../docs/pickup-witness.md)).
- **`reviewer-delivery-unwitnessed: … — cmux holds no record of anything submitted to <ref> in Nm, which is a
doubt and not proof it never started; re-submit <what it did>`** — the REVIEWER half of that same delivery
  record: a reviewer once sat fourteen minutes with its pickup typed and unsent while every
  `turn review --poll` said `still working`. **The line names a
  doubt on purpose**: an absent delivery record is not evidence of non-delivery, and a reviewer mid-verdict
  can carry one (one read WORKING at 5m22s). When the line is genuinely sitting
  typed in an IDLE input box, the sweep presses Enter on the copy already there — never a second copy, and
  never into a session mid-turn. `re-submit held` means it could not prove that and left the workspace alone;
  its parenthesised reason is where "this reviewer is working" appears, and it is still the report you act on.

## The budget warn — you are the witness, on this pass, and nobody else is

The diminishing-returns warn on a dispatched
answer is raised by THIS loop, on the sweep it already runs — never a planner session per tag, never a watcher.
Every still-working fresh dispatch gets one `budget:` line: its `dispatched` instant, minutes against the
lease, the warn mark (two thirds of the lease, PROVISIONAL until Q3 is ruled), stages declared this dispatch
and how long since the last, this dispatch's review round and carried claims, and the warn standing.

- **`budget warn raised (clock)`** — the mark was crossed; the sweep recorded that fact itself, once.
- **Your judgement is the witness note.** Read the line as evidence — converging, or circling? Stages that
  stop coming, a round that carries the same claims forward. When it is circling, carry ONE sentence of
  observation into your next due sweep, in place of that pass:
  `turn dispatch --sweep --ask <channel>/<messageTs> --warn "<observation>" --warn-dispatched <the line's instant>`.
  It records locally and returns — no screen read, no card edit, no finalisation — and the normal sweep
  resumes after. Observation only: never "wrap up", never "post now". A second note is refused; so is one whose
  instant a re-dispatch has replaced. Counts alone are not proof of circling — say nothing when they are all
  you have.

The worker reads the warn back on its next `turn status`/`turn resume` and decides; the card shows
`warn raised`, never your note. **The lease is unchanged** — where the conclude mark sits is the unruled Q3.

**This loop does no recipe work and checks no scheduler**: a due row is read by a
supervisor pass with `automation due` and either run there or seated (`skills/automation/SKILL.md`).

**This loop's own liveness watch wakes only on events.** A printed line is a model turn, so whatever polls
between addresses wakes this whole session, over its whole context, on every line it prints. MEASURED live:
a 5-minute tick with a ~30-minute idle heartbeat produced roughly 250 wakeups in a day against a
schedule of four cards, so 99% of those wakeups had nothing to do. So print
only on an EVENT — an address, a refusal, a binary-check failure — or on an hourly heartbeat while otherwise
idle. Poll as cheaply and as often as you like; what must stay rare is the PRINT. The `--follow` stream already does this correctly by
construction — one stdout line per admitted mention, with every reconnect frame and discarded ping routed to
stderr, exactly the "Never redirect stderr into stdout" rule above — so a `Monitor` watching stdout alone
wakes only on a real address, never on socket chatter. If this loop ever needs a SEPARATE polling shell
watcher around it (checking the listener itself is still alive, say), that watcher inherits the same rule:
poll as often as it likes, print only on an event or an hourly heartbeat. A monitor that wakes the model on
nothing is a token leak, not liveness.

**Every watcher script `cd`s to its worktree first — before its Monitor starts, never patched while the
Monitor is executing the file.** A shell watcher inherits whatever cwd its Monitor happened to have, and a
`slopweaver` verb that infers its subject from the environment (`github search` without `--repo`, and every
sibling that falls back to the cwd's `origin`) answers for THAT directory. MEASURED (handover
`cwd-resolved-repo-turns-a-watcher-into-a-liar`): the state home is itself a git checkout of a private state
repository with no open pull requests, so a hold watcher running in its loop directory under the state home
read `totalCount 0` on every cycle for three cuts, and the chain recorded a "search-index transient" that was
cwd, never timing. The verb now REFUSES a cwd under `$SLOPWEAVER_HOME` or one that is not a declared main
checkout's repository, so a watcher without the `cd` fails loudly (exit 1, the refusal on stderr) instead of
reading a plausible zero — and a `totalCount 0` is still settled by a DIFFERENT instrument (`github read` per
pull request URL), never by re-running the same search. The line is
`cd "$WT" || { echo "HOLD REFUSES: cannot cd to $WT" >&2; exit 2; }`.
