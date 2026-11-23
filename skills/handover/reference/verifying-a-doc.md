# Before you hand it over, verify it

What `handover check` and `handover lint --fix` each catch, and the four probe shapes that have read as green
while proving nothing. The rule — run the verbs, never hand-roll either check — is in [SKILL.md](../SKILL.md).

```bash
slopweaver handover check --doc <the file you just wrote> --repo <the repo it targets>
slopweaver handover lint --doc <the file you just wrote> --fix
```

`check` exits non-zero and names every finding: a referenced file that is not committed, a `--config` path a
`command:` probe names that does not exist on disk, a hard-coded count, a `blockedBy` slug no doc claims, an
unusable `status:`, a missing `artifact:`, an oversized `summary:` (below), and — for a doc already saying
`status: done` — the behavioural-probe rule in [SKILL.md](../SKILL.md). `lint` applies that same rule across the whole board, which is how a `done` set
by HAND EDIT is caught: nothing in this repository writes that line.

## `summary:` is capped, and `handover start` refuses a doc over it

**`summary:` is ONE LINE saying what the work is, and it is capped in BYTES.** `handover start` refuses a run
whose doc breaks the cap, and `check` reports it — the numbers and their reproduction command live in
`src/handover/summaryCap.ts`, so ratchet them there rather than restating one here.

Why a gate: the supervisor state doc is capped and that cap WORKS — measured, the
live state doc passes at 397 of its 400 lines. The accretion moved next door, into the `summary:` of the
handover doc the same seat boots from. Measured across the whole register: of the docs that are not a supervisor handoff
the largest `summary:` is a few kilobytes, while the supervisor handoff docs reach **560,851 bytes — 95.6% of
their own file**, carrying dozens of nested copies of predecessor boot text and growing every shift.

Two things that generalise past this one field:

- **The unit has to match the failure.** The state doc's caps count lines because a state doc is a document. A
  `summary:` is a YAML scalar with a median of one line across the whole register, and the 560,851-byte one is
  24 lines — so a line-counting gate cannot see this class at all, and reported green throughout.
- **Near-zero token cost was the symptom, not the reprieve.** A field that size stayed cheap only because the
  harness refuses to inline a half-megabyte file: a seat that `cat`s its own boot doc gets a couple of
  kilobytes of "Output too large" and reads fragments with `sed`. So the boot prompt's "read it end to end"
  had quietly not been happening for dozens of shifts, and the day a seat widened its `sed` range it would
  have inlined the lot.

The refusal fires at `handover start`, not at `git push`. That is deliberate and it is the same choice
`register-hygiene` already documents: the seat opening the run is the one that was about to boot from the
oversized doc and the one that fixes it in a single edit, whereas a push gate would stop a stranger in this
repository over a doc some other session wrote. Whatever a successor genuinely has to keep reading is a
standing rule, and a standing rule belongs in a file under `skills/`, not in a front-matter field.

**A `command:` probe naming a test-runner `--config` goes stale the moment that config moves.** Measured:
one commit relocated every `vitest.*.config.ts` from the repo root into `config/vitest/`,
and 49 docs across the board — 36 of them already `status: done` — still named the old root path in a
`command:` probe, so genuinely-landed work read as unproven (`handover-probes-name-moved-vitest-configs`).
`check` flags any `--config <path>` a `command:` probe names that is not on disk relative to the doc's own
repo — a machine check, not an authoring rule.

**A `command:` probe filtering `vitest run` by a directory or file needs `--passWithNoTests=false`.**
Measured: `vitest run --config config/vitest/unit.ts src/__tests__/unit/<dir>` exited 0 — PASS —
before that directory existed, and would have stayed green forever had the work never been written; the same
command with `--passWithNoTests=false` exited 1
(`handover-probe-vitest-filter-is-a-false-green`). `passWithNoTests` defaults to `false` in
`config/vitest/base.ts` for this repo's own three lanes, so a probe written against THIS repo needs no extra
flag — but `check`'s `checkFilteredVitestProbes` still refuses a filtered `vitest run` missing the flag
explicitly, because a doc's `repo:` can name a different checkout where that default does not hold. Write it
anyway on any probe filtering `vitest run` by a path, the same way `--config` is always spelled out even
though its own value rarely changes.

**A `command:` probe for a not-yet-built sub-verb needs an output assertion, not a bare exit code.** Measured:
`slopweaver github stack remove --pr <n> --dry-run` printed generic usage text and exited 0
before `remove` existed as a sub-verb, so a doneWhen probe gated on nothing but that exit code would have read
the unbuilt work as done, forever (`unknown-subverb-exits-zero-makes-probes-false-green`). Every dispatcher
returns a non-zero exit code for an unrecognised sub-verb, but the probe SHAPE is still weak evidence on
its own terms — a `--dry-run` that silently does nothing also exits 0, the same loophole the `vitest run` rule
above closes. `check`'s `checkBareSubVerbSuccessProbes` refuses a `command:` probe that is a bare
`slopweaver <noun> <verb>` invocation gated on success with nothing asserting what it printed. Two ways to
satisfy it: pipe into `grep`/`diff`/`cmp`/etc. and assert on the actual output, or — when the doc is instead
proving a REFUSAL, the way the doc that measured this one does — check that the invocation FAILED
(`; test $? -ne 0`, or a specific non-zero code) rather than that it succeeded; that direction never reads
"not built yet" as "done".

**An ask row carries its own done-check when its anchor is a Slack message**. `handover
register` writes `slopweaver slack replied --url '<anchor>' | grep -q '^replied at '` into `doneWhen`
(`src/handover/askDoneCommand.ts`); any other anchor gets `doneWhen: []`, and the card reads "done when you rule on
it or it is settled". `slack replied` exits 0 replied, 3 not yet, 1 could not check. `handover currency` — the
latest recorded currency check the Queue card's mark draws from, the tick's or the Queue opening's — evaluates that
one check in-process, recognised by EXACT equality with what the register wrote, and never runs any other doc's shell
(its text read counts the cards and names only those with something to act on; `--full` lists every one):
a hand-edited check reads "declared, not run by the currency check". A passed check makes the card **looks answered**; the chair settles it, never the reading —
`handover settle <slug> --as answered --witness <reply link>`, recorded with `autonomy record`. The same reading
carries `pullRequests`: for each pull request a waiting row names whose stored quotes of the owner's ask for proof, whether
the live body carries it (`requested-and-met`, `requested-and-unmet` with the gap a card leads with, or `body-unread`
— never "missing" over a read that failed). It is the reading's one GitHub read, so the talk pack and the Queue make
none (`src/handover/prProof.ts`). A verdict joins a card by its row's slug only while that row still names the pull
request on the board being read (`prNamed` on `handover list --json`): the reading is a tick old and a slug is reused.

**`lint` also refuses a doc whose FENCED commands `cd` into a main checkout `profile.json` declares.** A doc
that hands a child a worktree must not also hand it a command that only works outside one — measured,
that instruction is what put a child in a shared checkout, where it renamed the trunk branch and
committed on top. State inline what the command would have produced, or find a route that works from the
worktree; `--fix` will not choose between those for you. Prose is not checked, so a doc may still recount the
instruction it is refusing. See
[docs/main-checkouts/cwd-safety-and-scope.md](../../../docs/main-checkouts/cwd-safety-and-scope.md#a-child-must-never-work-in-the-shared-main-checkout).

`lint --fix` defaults `artifact: null` into the doc's front-matter in place when the key is absent, so it never
reaches a push missing it, and refuses (never guesses) when the front-matter cannot be parsed cleanly. Run
`lint` after ANY hand-edit to a doc's front-matter, not only right after writing it — a half-finished edit is
exactly the state that has blocked another session's push before.

If a referenced doc is genuinely missing, **stop and say so** rather than substituting something similar.

---

## Every path in the BRIEF is rooted — absolutely, or with `state:`

**A seat never scans the disk for a path the chair named.** A brief that says
`supervisor-scratch/handoff-<n>/owner-images` says nothing about what that path is relative to:
it is not in the repository, the seat has no second root to try, and so the seat goes and looks. A docs
seat did exactly that — a breadth-first scan from `/`, three cores for eleven minutes.

So write a state-home file **absolutely**, or with the `state:` prefix the autonomy verbs already use:

```text
supervisor-scratch/handoff-<n>/owner-images     ← refused
state:supervisor-scratch/handoff-<n>/owner-images
/Users/<you>/.slopweaver/supervisor-scratch/handoff-<n>/owner-images
```

`slopweaver handover register` and `slopweaver cmux spawn` refuse a brief carrying one, and the refusal
prints the rewrite for every token it found. **Scope is the BRIEF** — the front matter plus
the owner's request section — because everything below that is written by a session standing in a checkout, where
a repo-relative path resolves. The criterion, the two-set difference behind it, and the measurement that
rejected a backticks-only scanner:
[doctrine-rationale](../../../docs/doctrine-rationale/seat-never-scans.md).

The reader end is the same class from the other side: the seat-side `disk-scan-guard` refuses a `find`/`bfs`
rooted at `/` or `$HOME` and names `ls $SLOPWEAVER_HOME/<first-segment>` and `rg --files <folder> -g '*<name>*'`
over one likely folder instead.
