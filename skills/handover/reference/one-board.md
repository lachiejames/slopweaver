# One board: a tag is a row, an ask is a row

The board holds three kinds of row on one ranking, and a thing the owner asked for
is a row on it with a terminal state, the same register as everything else.

## Why the register was needed

The board registers WORK. Nothing registered an ASK, so an ask survived only when a session happened to
notice it was a list. Measured from the owner's own transcripts: a batch of six numbered card-polish
items with screenshots reached the board inside about thirteen minutes and four of them shipped, while a
stuck-chat ask — given mid-paragraph in a voice dump — was restated NINE times over thirteen
hours before any doc existed for it. The owner should never have to say the same thing ten times and still not
have it done: say it once and never again.

## Three kinds, two of them authored

| kind  | what it is                    | where it lives                                        | default band |
| ----- | ----------------------------- | ----------------------------------------------------- | ------------ |
| `doc` | planned work                  | a file in `$SLOPWEAVER_HOME/handovers`                | `p2`         |
| `ask` | something the owner asked for | a file in the same directory, `kind: ask`             | `p1`         |
| `tag` | an unanswered Slack tag       | PROJECTED from the ask-lifecycle stream, never a file | `p0`         |

A tag is a row and never a file. It already has an exact, append-only register keyed by `(channel, messageTs)`,
and a markdown file per tag would be a second source of truth — the board's own rule for docs, pointed the other way.

`kind:` defaults to `doc`, so a doc need not declare it. A `kind:` this board does not know is reported
as a defect rather than swallowed, because a mistyped kind would otherwise drop the row silently. What a row IS beyond its kind — platform, workstream, impact, the pull requests it names — is a typed tag in its journal: [row-tags.md](row-tags.md).

## Registering one

```bash
slopweaver handover register --ask "Should listen status count every stuck chat?" --anchor <slack permalink>
slopweaver handover register --ask "..." --asked-ts 978318000.000000   # when there is no anchor
slopweaver handover register --ask "..." --anchor transcript:<sessionId>#<turnUuid>   # typed into the supervisor
```

`askedIso:` is the field the register turns on: an ask's cost is the LATENCY between the owner saying a thing
and anything existing for it, and that number is uncomputable unless the moment the owner said it is written down. **What the owner SAID there is stored too**: `register` writes the verbatim quote a `talk:`, `call:`, `talk-call:` or `transcript:` anchor names, or why it would not read — a `transcript:` turn the console typed into the chair (a relay's delivery, a wake) is never quoted as the owner's, and is stored unread naming the `talk:` or `talk-call:` record to anchor on — and `handover quote [--apply]` backfills and refreshes it on every row, settled ones included; `handover quote --check` is the release gate, failing while a row needs a write or a board file will not read. Every further steer of the owner's on a row is stored beside it, `handover quote <slug> --add-steer <anchor>` or a call landing on its card, and drawn oldest first ([bears-on.md](bears-on.md)). A row naming a pull request also publishes `prSteers`, the owner's words stored on every OTHER row naming the same exact `owner/repo#number`, joined over the whole board before any filter (`src/handover/prSteers.ts`) — a quote travels only when it is ABOUT that one: its row names no other pull request, or its own words name it. A `[Image #N]` placeholder names nothing. An act card whose run or row-named subject is off the live board reads NOT READ, never fleet; a card landing quotes its `call:` row itself. A row born with NO anchor is tied to the turn it came from by `handover quote <slug> --anchor <anchor> --apply`, anchor and quote in one write, refused for an anchored or archived row, unreadable words, the console's own relay line, or a turn typed while that session did not hold the supervisor pin; `profile words` finds the turn, and `register` prints both when a session types it unanchored. The queue card leads with it, and REFUSES when the anchor names the owner's words and the row carries none (`src/handover/hisWords.ts`). **A `talk:` relay row keeps the owner's words and is never reworded** (the owner's ruling, after 38 rows were rewritten by plain `Write` calls): the `relay-words-guard` hook refuses a `Write` or `Edit` on the board or its archive that leaves the row's `summary` unable to rebuild to its turn's digest, its quote unequal to the turn's record, its heading or first section paragraph unequal to the summary, its anchor moved, a further steer's quote hand-edited, or its offer section other than the turn's offer. Any other field edits freely, and an exact restore passes. The quote is rewritten with `handover quote --apply`. The hatch is `SLOPWEAVER_ALLOW_RELAY_WORDS=1`, and a `Bash` write is not seen (`src/admit/relayWordsJudge.ts`).

**An ask typed into the supervisor has an address too.** `slopweaver supervisor intake` walks the WHOLE
supervisor chain — every session that has held the pin, from `slopweaver supervisor chain` — and lists every
turn the owner typed into any of them as a `transcript:<sessionId>#<turnUuid>` pointer and prints the exact
`register` line for each one nothing witnesses; passed as `--anchor`, the instant is read off the turn itself
and a pointer naming no turn in that transcript is REFUSED. A turn that answered an existing ask is witnessed by
settling that ask with the pointer as `--witness`; a turn that became a briefing card, answered a run's question,
or asked for nothing is recorded with `slopweaver supervisor intake-mark`. The sweep's reconciliation counts the
turns with none of those, because MEASURED, an answer composed in the supervisor's own chat was never
registered and died with that session — so a thing the owner sends the supervisor becomes
a row or a card the same tick, never a chat reply alone.

**A short chain says so.** Without coverage, reading one session looks identical to reading sixty-eight:
MEASURED, `intake --since <date>` reported `7 read, all witnessed` while sixty-seven
predecessors went unlooked-at. Every read carries its coverage, and a window the chain cannot reach prints
`the chain starts at <iso>, so anything earlier was NOT read` with the rescan that fixes it.

**You never type that instant.** Given a Slack `--anchor`, the verb reads the `ts` out of the permalink and
derives it; `--asked-ts` does the same from a bare `ts`. `--asked-iso` is the escape hatch for an ask that did
not arrive in Slack, REFUSED unless it parses.

The reason is measured. A run hand-converted `978318000.000000` to an instant 80 minutes later than
`2001-01-01T03:00Z`, the true one: **80 minutes out**. The wrong instant left this row and reached two cron
schedules, a doc's `statusSummary` and two supervisors' deadman deadlines, and the announcement those
governed went out 53 minutes late. `handover lint` REFUSES a row whose `askedIso` sits more than a
minute from the instant its own Slack anchor names — the check that would have caught it, and the reason
`--anchor` is worth passing even when you also know the time. Convert anything else with
`slopweaver slack when <ts-or-permalink>`.

## Settling one — three terminal states, and who may set each

| `--as`     | witness it carries                                             | who                                    |
| ---------- | -------------------------------------------------------------- | -------------------------------------- |
| `filed`    | the doc slug it became (the board or its archive must hold it) | any session — the witness is checkable |
| `answered` | the permalink it was answered at                               | any session — the witness is checkable |
| `declined` | an anchor, plus a reason in the owner's own words              | the OWNER only                         |

```bash
slopweaver handover settle <slug> --as filed --witness <doc-slug>
slopweaver handover settle <slug> --as answered --witness <permalink>
slopweaver handover settle <slug> --as declined --witness <anchor> --reason "<the owner's words>"
```

`filed` and `answered` place the row under `DONE`: the owner's ask WAS actioned, which is the number this register
exists to report. `declined` places it under `CLOSED — NOT SHIPPED`, beside a cancelled doc, because an ask
talked away and an ask actioned must never be counted together — that conflation is why settlement is its own
field rather than a reuse of `status:`.

**An `answered` witness that is a bare pull request URL is checked against the owner's words**: when they ask for proof,
the body is read live and the settle refuses naming what it lacks ([settle-proof.md](settle-proof.md)).

**Settling the row does not end the RUN** — `handover finish` does, or `settle` itself when the holder is
DEAD (the reaper's `orphaned`) or the run is parked or released with nobody holding it (`finished`, or `abandoned`
for a decline). Until then `close-done` cannot reap it. See [running-a-run](running-a-run.md). A relay row spoken over an open hand card also takes `--card done|recut|kept`: [settle-card.md](settle-card.md).

**A decline is not enforced by checking who is calling**, because nothing here authenticates a human
(`.claude/rules/cross-session-messages.md`). What is enforced is that it is ATTRIBUTABLE: a decline with no
anchor or no reason is refused, and a settlement with no witness makes the row a `CONTRADICTION` on the board
rather than closing it. An agent cannot close one of the owner's asks by asserting that it is closed.

**A settled ask still reads `status: ready`, and every door asks `settlement:` instead.** `settle` does not
touch `status:` — writing a terminal one beside `settlement:` would be a second source of the same fact, the
same reason `doc.ts` refuses to let a doc DECLARE `blocked` when `blockedBy:` already derives it. So do not
read a settled row's `status:` as meaning anything: `handover list` places it under `DONE`/`CLOSED — NOT SHIPPED`,
`handover reconcile` drops it from the ranking, and `handover start` and `cmux spawn` refuse it by name — all four
through `askRow.ts`'s `settledAskOf`, ONE read, because they disagreed for as long as each asked the field itself
([derived-row-state](derived-row-state.md)). MEASURED: an ask row
was settled `answered` with its card live, and the next supervisor spawned it as a cmux workspace, which did nothing.

**A finished DOC is the same class**: `finish` leaves `status:` alone too, which left **78 finished docs reading `ready`**, so both doors ask the JOURNAL — [running-a-run](running-a-run.md).

## Waiting on a person: `pause`

A row waiting on somebody else is neither in flight nor finished: no time limit, no deadline, a work stream the
owner thinks is useful but paused on someone else. `handover pause <slug> --on "<who>"` parks it under `PAUSED`: live, visible on
the board and in the owner's briefing, never ranked as the owner's move, with nothing that can ever be overdue. `handover unpause` is the
deliberate act `start` and `cmux spawn` refuse to perform for you. Why it is a status when `blocked` is not,
and what outranks it: [paused-rows](paused-rows.md).

## Ranking, and what "placed" means

Priority band first, then the owner's landing rows within p1, then a row the owner RULED on ahead of one the owner did not, then a PLACED
row ahead of an unplaced one, then the longest wait, then the slug. A ruled row is decided work waiting on nothing
but a seat, kept inside its band; a **placed** row declared `priority:` or carries the instant it started waiting,
and an unplaced row never counts toward the top. Why each, measured: [ranking.md](ranking.md).

**Which workspace's view draws a row** is read off its stated facts, and a row they leave unplaced or name both
on is drawn in `self` alone, marked placed by default — one rule: [workspace-views.md](workspace-views.md).

## Reconciling the fleet against the board

```bash
slopweaver handover reconcile            # one line per row, labels cut to 120 chars, five lines per finding
slopweaver handover reconcile --full     # every label whole, every finding uncapped
slopweaver handover reconcile --json     # every row, for a briefing composer
```

Six findings, kept apart because a reader acts on each differently. **The headline states ONE: `starving`,
the number to chase to zero**, and whether a session could move to it (never make the owner do arithmetic):

- **misaligned** — a session on a placed row below the top band. Real work, just not the most urgent.
- **unplaced** — a session on a row nobody has ranked. A statement about the board, not the session.
- **unregistered** — a session on nothing the board claims. This is the finding that catches the original
  defect: the owner said something, a session did it, and no row was ever created.
- **starving** — a READY top-band row nobody is on. PLACED is not startable: the rest are **held** ([top-band.md](top-band.md)).
- **stale asks** — an open ask past six hours (between the thirteen-minute working case and the 13-hour one).
- **unwitnessed owner turns** — `--json`'s own `intakeClause` field, and its own line in the human read:
  turns the owner typed into any supervisor in the chain, past one sweep tick, that no row anchor, settlement
  witness or intake mark names. A read that could not be made prints its reason there instead of a zero. A
  SEPARATE field rather than the headline's second sentence because the two joined ran to 94 words and 3
  sentences against the alignment caps of 55 and 2 — the briefing carries it in that line's fold.

None is automatically a defect. The contract is that the sweep SAYS so, never that the numbers are zero.

**EVERY live session is answerable to a row, and there is no exception list.** An automation runs in a
session `automation seat` opens, and `seat` writes the board row BEFORE it opens one , so no
session shape needs excluding from `unregistered`. An exception predicate that matches nothing reports "all
clear" in exactly the voice it would use if it had stopped working, so none is kept.

**The sweep cannot skip it.** `briefing render`'s form carries a REQUIRED `alignment` field — `headline` and
`intake` — so a briefing that does not state this comparison cannot be rendered, and `briefing check` refuses a
hand-written page missing the block. That is the mechanical half of the rule: when the owner gives the same feedback multiple times it is time for a
mechanical fix, and an instruction telling a session to remember to compare two lists does not close it.

## A finding is a row too — and it asks the owner before it reaches the team

A fleet finding — two watcher deaths a session observed, a script that died
silent — MAY be registered as an ask ranking with the owner's asks, and the row must SAY it is a finding. Measured:
`watchpr-dies-silent-on-an-unchosen-signal`, registered from two watcher deaths nobody had asked about and
marked as nothing, went up as a pull request on a team-reviewed base under the owner's name, and the owner closed
it the next night with no memory of asking. Presenting the finding to the owner is useful; work reaching a teammate
the owner has never seen is the defect. **`AGENTS.md` rule 10 does not touch this gate** — that rule finishes work
the owner already OWNS, and a finding is the fleet's own idea.

So a finding is an ask row with PROVENANCE, and the doors that reach a teammate gate on it:

```bash
slopweaver handover register --ask "<what was observed>" --finding --evidence <ref,...> --repo <checkout> [--observed-by <session>]
slopweaver handover rule <slug> --anchor <where the owner said it> --words "<the owner's words>"      # the owner's yes
slopweaver handover settle <slug> --as declined --witness <anchor> --reason "<the owner's words>"  # the owner's no
```

- `origin: finding`, `observedBy:` (defaults to the registering session's own id) and `evidence:` go on the
  row. A finding missing either is a defect the board prints, and the page is headed **What was observed** /
  **Where this came from** — never "What the owner asked for", because nobody asked. The board prints an `origin:`
  line under every finding, a `ruling:` line under EVERY row that has one, and a `doors:` line on a finding.
- **`github stack push` and `github pr request-review` REFUSE a branch whose row is an
  unruled or declined finding** — matched exactly (row `branch:`, journal branch, or slug), never by resemblance;
  the refusal defines the gate and names the row, its origin and the clearing verb; no acknowledgement flag, and
  a BACKFILLED ruling never opens it. **NOT gated**: a PR on this install's OWN
  repository — rule 10 judgement, ONE `finding-pr.<slug>` autonomy-register act or shut.
- A ruling is the owner's words plus a pointer to where the owner gave them — attributable, never authenticated, exactly as a
  decline is. It is a journal EVENT on any row kind, superseding by DECISION time and
  writing no document at all: [derived-row-state.md](derived-row-state.md).
- **A finding reaches the owner as a rendered page, never as its markdown doc**. The seat publishes it with
  `slopweaver page publish` — what was measured, why it matters, the candidate causes, the options with their
  cost — and that address is the card's url; `briefing render`, the form and `briefing check` REFUSE a card or
  an open-pages entry whose url is a markdown document: [finding-page.md](finding-page.md).
