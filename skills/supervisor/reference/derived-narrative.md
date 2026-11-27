# Deriving the briefing's narrative sections — the tick ledger

`recent`, `earlierToday` and `history` are
**92.9% of a live form's bytes and 164 of 169 render refusals**, and they are a LOG rather than prose. So they
get derived from the ledgers the way `yourList` and the pull-request cards already are — a sweep registers
and derives rather than authors — which cuts what this seat spends on Fable every tick and removes a point of failure.

Two conditions on it: the derivation must not lose critical context, **above all what THE OWNER said**, and must
re-derive it without anything being re-explained; and it takes a Codex plan pass and a Codex review pass,
because this is the one session the owner talks to.

**The RECORDER and the PROJECTION exist; the published page does not use them yet.** `slopweaver supervisor tick-record
--draft <json|-> --reconcile <json|->` appends ONE finalised row per tick to `$SLOPWEAVER_HOME/ledgers/
supervisor/supervisor-ticks.jsonl`: the tick's twelve source readings, what the sweep then DID, any structured
judgement, and **every owner turn since the last tick, verbatim**. `briefing render --ticks <path|->` projects
that ledger into the three sections. The PUBLISHED invocation passes none of it, so the form carries the
three authored sections — see § The shadow shift.

Three things about the row that are the contract rather than a note:

- **It is finalised AFTER the tick's fill and re-arm decisions**, so it carries what the sweep did and not
  only what it read. That is the one ordering the sweep contract's steps 12–14 make necessary.
- **Every source is accounted for or explicitly `unavailable` with a diagnostic.** Silence is the third state
  a reader cannot see, and it renders exactly like a clean fleet.
- **The owner's words come off `handover reconcile --json`, not out of the draft.** MEASURED against the
  live form: of the **19 owner turns** that tick's own reconciliation had read, **zero** appear in the page it
  authored — not verbatim, not as a 25-character fragment. A sweep that could type them could summarise
  them, so it does not get to.

**Two gaps this states rather than hides.** The owner-turn read is a trailing 24-hour WINDOW rather than a
per-session line cursor, so a transcript line written late with an older instant can fall between two ticks;
and a lock-in row carries no structured owner-turn pointer, so a ruling is never joined to a turn by
guessing at its prose (`lockInLink` reads `none`). Both are named on the row itself.

**Every reader is strict, and a stale `stats` is repaired, never tolerated.** A row whose recorded stats disagree
with its content refuses the whole read, so a ledger carried through a sanitiser that rewrote text inside its rows
is resealed with `slopweaver supervisor tick-reseal`: the bare run previews and prints the ledger's sha256;
`--apply --source-sha256 <hex> --reason "<why>"` backs the file up, rewrites only the stale rows under the lock the
append takes too, reads it back through the ordinary reader before installing it, and journals a receipt in
`ledgers/supervisor/tick-reseals.jsonl`. Any other defect refuses the reseal, naming its line.

## The projection: `briefing render --ticks`

```bash
slopweaver briefing render --form - --ticks "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl" \
  --ticks-days 0 --out <html> < form.json
```

OPT-IN: with no `--ticks` the page renders from the authored form alone. That is deliberate: a
one-shot cutover would make the only page the owner reads depend at once on a new capture format, a new projector, a
new quoted-note lane and new CLI wiring, with no production observation in between.

`src/briefing/narrative.ts` is the projection and `src/briefing/narrativeSources.ts` is how each of the twelve
readings reads. Both are pure; the render verb does the reading. What they decide:

- **`recent` is contractually LANDINGS** — one note per landing the NEWEST recorded pass saw, oldest first.
  `renderRecent` labels the section `"N landing(s) since you last looked"` and derives that N from the
  array's own length, so anything else in it makes the page's own sentence false; the owner's ruling is why the
  section exists. More than five refuses rather than cutting one.
- **A day is a MELBOURNE day.** `src/briefing/localDay.ts` owns the boundary and the page's eyebrow imports
  its zone, so the two cannot drift. A 09:30 sweep on a UTC machine is 23:30 the previous day by `Date`'s
  reckoning, which would fold the owner's whole morning under yesterday.
- **`earlierToday` is a ROLLUP of at most five notes** — sources, the owner's words, other landings, what was done,
  what was judged — because `SECTION_MAX_NOTES` is 30 against up to 72 passes a day. `history` is the same
  rollup per prior day. `briefing archive` is the remedy for the AUTHORED sections only and the verb says so:
  under `--ticks` an oversized page names `--ticks-days` instead, since archive trims fields the run overwrites.
- **Nothing is dropped without saying so.** Every recorded turn, landing, act and judgement is an ATOM, keyed
  structurally (`<tickId>/actions/2`). The projection refuses unless each is accounted for exactly once, and
  only a REPEAT observation may be folded away — with the atom that stands for it named in the receipt. Two
  observations of one transcript position that disagree refuse outright. `--ticks` prints the receipt.
- **A record is quoted, never re-worded.** Every note whose fold holds recorded text carries
  `lane: "quoted"`, which takes it out of the bare-key-link rule, the packed-enumeration and
  truncated-ellipsis refusals, and the plain-wording gate. Each of those is an instruction to a COMPOSER and
  there is nobody to instruct on a projection. Measured: rendering the live ledger produced
  thirteen plain-wording refusals, every one a fleet word inside a string some other verb had already written.
  What each note COMPOSES — its headline, its fold summary, the day's section summary — stays gated.

**`--ticks-days <n>` is the size lever, and it exists because of a measurement.** A full five-day window of
this installation's ledger renders to 932,162 bytes against `PAGE_TEXT_MAX_BYTES`'s 262,144, the owner's own recorded
turns being 213 KB of that. A projection may not cut the owner's words to fit, so what gives is how far back the page
reaches — and both the page and the receipt state how many days and rows are not shown.

## The shadow shift, before any cutover

Keep the published invocation unchanged. Each sweep, render a SECOND page from a form with `recent`,
`earlierToday` and `history` dropped plus `--ticks`, and do not publish it. Compare across at least one
Melbourne-day rollover, checking every authored claim maps to a recorded source, landing, act, judgement or
turn — a claim that maps to none needs a new recorder field before cutover, not a hand-written note.

Cutover is a later change: drop the three fields from the published form and add `--ticks` to the real
invocation. `sweep-contract.md` describes the AUTHORED path until that lands.

## Recording a tick

**`tick close` is also the SWEEP GATE**, through the `tick-record` gates it composes. It refuses a tick that left capacity free while a ready row under
one of the owner's kept outcomes had nobody on it and the draft gave no reason — answer it with a spawn onto one of
those rows, or a `hold-rationale` judgement whose subject is `{"kind":"outcome","id":"<id>"}`. That is why
`TickSubject.kind` carries `outcome`: [stated-outcomes.md](stated-outcomes.md).

```bash
slopweaver supervisor tick open --dir <scratch>    # readings, digest (changed since tick n-1, the rest in tick-<n>/digest.txt), tick.json to fill
slopweaver supervisor tick close --dir <scratch> [--your-list <path>]   # validate, then form, page and this row LAST; prints the prompt
```

**The digest names the rows, not only the counts**: the head of the ready list, each seat not working, each alert
event, each seat past its depth threshold, each row close-done closed and each dispatchable landing, eight a list
and then `and N more`. A `jq` or `grep` over a file in `tick-<n>/` is the digest's defect: add the line here.

**It prints what CHANGED since tick n-1, never the whole digest twice** (`src/supervisor/tickDigestDelta.ts`): the
whole digest is written to `tick-<n>/digest.txt` first, one entry per line (a newline inside one reads `\n`). `queue leader:` and `stopping the owner's work:` still lead,
changed or not; then `changed since tick <n-1>` lists each line the previous tick did not print, `still standing`
repeats every obligation unchanged — the gauge's `CHAIR` and `REACT NOW`, a `BROKEN` or absent automation, any `UNKNOWN`/`NOT READ`/`unavailable` line — and
ONE `unchanged since tick <n-1>` line names the sections it folded and the file holding every line: Read that file
to drill down. Lines compare by a key that blanks only a generated shape's moving numerals (a watch age, the load
triple, a `PLAN` line's percentages and resets, a clock clause), so a pull request number or a due count still
differs. The seat's first tick, or a tick n-1 that left no `digest.txt`, prints every line under a line saying why.
The order below is the digest's, and the changed and standing lists keep it.

**Its first line is `queue leader:`** (`src/supervisor/digestQueueStopping.ts`, reading `queue-stopping` from
`slopweaver queue stopping --json`): the first card stopping the owner's work, in the owner's Queue's order — a blocker on one of the owner's
priorities, then a stopped automation or one held on the owner's word — with its deep link, then one `stopping the owner's work:`
line per such card. **Raise them where the owner's Queue draws them** (the owner's P0s: never buried, and one
order): open your chat update on a blocker; raise a stopped automation straight after the owner's priorities. `none` is the
only clean answer; `INCOMPLETE`, `CONSOLE NOT READ` and `NOT READ` are unknowns, never none.

**Then it opens on the decisions, each ending in the command that acts** (`src/supervisor/digestActFirst.ts`). `broken:`
is one `BROKEN <recipe>` line per automation held on a failure finding, saying whether a seat is on the finding and,
when none can be, why — a row with no `repo:` prints the `handover set-repo` naming the checkout `--repo slopweaver`
resolves to in this home, or that verb's refusal when none does, and the spawn. A slug two docs claim
(reconcile's `sharedSlugs`, or an id `held` and `ready` repeat between them) prints no command at all, since both
verbs refuse it. `sidebar:` is the freshness report's own
reading (`automation freshness --json`, reading `freshness`, `src/supervisor/digestSidebar.ts`), worst state first, with the age since each
source's last verified sync. `seatable:` names the first three ready rows no seat is on (by cmux, or by reconcile's own placement), naming a `repo:`, and the previous tick's
`hold-rationale` did not hold, each with its spawn, then each held one as `held by tick <n>:` with its claim. A hold
matches by EXACT handover id — the subject or a `relatedSubjects` entry, never the claim's prose — so to hold a
stack, name each row. It is tick-local: it shortens this list and exempts nothing from `tick close`. Right under it,
`held:` says what the rest of the board is — how many rows are open, how many ready, how many held only for naming
no `repo:` (each lifted by `handover set-repo`), held by a moved trunk, waiting on the owner, paused, in flight, otherwise
blocked (`src/supervisor/heldWork.ts`) — because `seatable: NONE of 2` once read as the whole of a 116-row board.
**A chair never says there is no work while that line counts an open row**: `tick close` refuses any string in
the tick claiming it, and the pinned chair's `Stop` hook refuses a chat reply claiming it over the newest kept
reconcile reading (hatch `SLOPWEAVER_ALLOW_NO_WORK_CLAIM`, `src/supervisor/noWorkClaimGate.ts`). Only then the
counts, and `recipes <band>:` lines, most late band first. A missing reading prints `UNKNOWN`, never a clean line,
and so does a due row naming no recipe, or holding on a finding without the `offReason` and `lastRunAtIso`
`automation due` writes beside one, a row with no `due` verdict, a reconcile placing a
session on no row id or calling a row repoless that is not on `held`, a ready row without the `label` and `priority` every board row carries (never offered a
spawn), a previous `tick.json` judgement `tick close` would refuse, or a freshness row without the
`source`, `behindMs`, `label` and `problems` shapes `automation freshness` writes (raised, never counted current).
Every command acts on the board its line was read from. `handover reconcile`'s repoless and held lines carry the
`--dir` and `--home` it was given. `tick open`'s carry no `--home`: an ambient tick's readings run against the
ambient home. **A `--home` naming any OTHER home confines the tick to it** (`src/supervisor/scratch/tickConfinement.ts`):
every child runs with `SLOPWEAVER_HOME` set there, each monitor is rehearsed without `--fire`, the readings that act
on the world or read the owner's live state (events cursor, close-done, wake, landing, bump drive, gauge, Codex
route and reset, Queue, hand recheck and wake, org health, turn sweep) are WITHHELD, and stopped-recipe seating
is too; the header opens `CONFINED tick:` and names each withheld reading and why. The same holds for
`tick-capture --home` and `tick close`'s list refresh. What it does not move: a kept reading that reads the cmux
socket, Claude transcripts, a Codex home or the process table still reads the machine's own, and the build-freshness
check may write the checkout's source-listing cache under its `.git`.

The row is close's LAST write. It reads the `handover reconcile --json` document `tick open` captured and takes
the owner's turns out of it itself. **The draft is assembled in process from what `tick open` captured, never by a
script** (`tick-draft` and `tick-record` stay as the lower verbs for a hand repair): each
reading is the file its source verb's own JSON went into — `machine capacity --json`, `claude gauge --json`,
`listen status --json`, `handover reconcile --json`, `session watch --json-report` (not `--json`, which drops the
suppressed count and the instant), `session close-done --json`, `automation due --json`, `velocity --json` and
`reflect friction-review --json`. `--captured` is when the undated ones were taken. The draft carries `tickId`,
`workspace`, `handoff`, `startedIso`, the twelve `sources`, any `actions` and any `judgements`, and may not carry
`ownerTurns` or `stats` — both are computed, for the same reason the form may not write `yourList`.

What it will not do, by construction: fill a fact. A source with no flag is `unavailable` naming the flag; a
reading that cannot supply every fact is `unavailable` with the producer's reason; `depth`, `github` and
`landings` are always `unavailable` (no producer yields a respawn decision, pull-request state or landed
identities); a file of the wrong shape refuses the whole draft. Every witness reads `read <path>` with a `null`
exit code, because a redirected file is not a receipt for how its command exited.
