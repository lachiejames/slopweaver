# The behavioural probe — what `doneWhen:` must actually assert

The refusal, the waiver that stands it down, the measurement behind it, and three worked examples from real
docs on the board. The rule — no doc may be set `done` without a probe that would FAIL if its claim were
false — is in [SKILL.md](../SKILL.md).

`doneWhen:` is a list of observable consequences the repository can be asked about, re-evaluated on every
board read; a `done` doc whose probes regress lands in `CONTRADICTION` on its own.

**No doc may be set `done` without at least one probe that would FAIL if its claim were false** — asserted
against live state or a live command, never against the presence of a symbol, a heading, or a file.
`handover finish`, `handover lint` and `handover check` all apply it, naming the doc and what a behavioural
probe would look like.

**It refuses by default, and the escape is recorded.** Fail loudly by default,
with an escape hatch — with the reasoning that bounds it: a hard refuse is heavy-handed with diminishing
returns, because proving that the owner will not raise this complaint twice is often genuinely infeasible under the
current test setup. A loud default with a hatch makes an agent try harder without blocking a landing.

The hatch is `probeWaiver:` on the doc. Write why no behavioural probe can exist, in your own words; the gate
stands down and every surface PRINTS the waiver instead of passing over the doc in silence, so an
unsanctioned `done` stays visible on the board:

```yaml
probeWaiver: "landed on the private work repo — no probe runnable from this checkout; see the partition"
```

Drop it the moment a probe becomes writable. `SLOPWEAVER_BEHAVIOURAL_PROBE_MODE=advise` demotes the whole
rule to advisory — the same finding, marked `ADVISORY`, failing nothing — and is not the shipped default.

```yaml
# REFUSED — every one of these stays true while the behaviour underneath it goes wrong
doneWhen:
  - present: "skills/supervisor/SKILL.md#never blocks on" # greps its own heading
  - absent: "src/live/turn/sweep.ts#oldSymbolName" # a refactor already removed it
  - command: "test -f src/handover/thing.ts" # the file exists; nothing ran

# ACCEPTED — it runs the thing the owner complained about, and exits non-zero if the complaint comes back
doneWhen:
  - command: "slopweaver turn status --help | grep -q fresh-visible-session"
  - command: 'slopweaver slack post --as me --form - --dry-run < f.json | grep -q "<@U"'
  - command: "yarn test:unit github/merge --coverage.enabled=false"
```

**Every doc triggers the rule.** The owner-ask phrases — `OWNER ASK`, `OWNER RULING`, the possessive-pronoun forms of
"words" and "ruling", and a pronoun or `the owner` + `asked`/`ruled`/`wants`/`told` — are matched only to name the
quoted phrase back to you in the refusal. Measured, a keyword trigger left 334 of 477 `done` docs outside the
rule, and a wider phrase list is heuristic on heuristic, so the trigger is unconditional. A `command:` probe counts as
behavioural unless everything it invokes is a plain file-or-text inspector, so a bare `grep`/`test -f`/`test
-s` does not count and a `cd` in front of one does not rescue it.

**A waiver is a first-class answer, not a failed one.** Saying plainly that no probe can exist here is the
honest outcome the rule wants, and it is precisely why the rule can afford to apply to every doc. Measured
over the same board: 40 honest `probeWaiver:` entries appeared where the gate had found zero before it.

Why it is a refusal and not advice: measured, five owner-ask docs marked `done` failed a live
re-check on the exact complaint they were written for, and every one of them still had green probes — three of
those five landed **gold**. A gold proof proves what was built on the day it was built; with no behavioural
probe, nothing re-asks the question afterwards, and the owner gives the same feedback multiple times. Writing the probe costs nothing at `done` time, by the session that just
proved the fix, and a morning to reconstruct three days later.

`SLOPWEAVER_ALLOW_STRUCTURAL_PROBE=1` is a one-shot break-glass on `handover finish` alone, for a session that
must close now and record the waiver next. It is loud and it leaves nothing on the doc, so the message tells
you to write `probeWaiver:` as well — prefer the waiver, which is the sanctioned form.

The rule applies to TRANSITIONS into `done`. A `done` doc with no behavioural probe is
`behavioural-probe-retrofit-27`'s on the board, not the session's that trips over one.

**Three worked examples, real docs on the board, not the illustrative snippets above.** Each is a `doneWhen:`
that runs the door itself and would fail if the exact complaint it was written for came back:

- `as-me-door-cannot-mention-the-bot` — the door was `slack post --as me`, which could not tag the bot at all.
  The probe builds a hermetic fixture home (its own `profile.json` with `slackBot.selfUserIds`, and a
  pre-built FRESH derived-roster stamp so it never touches the real corpus or pays for a real `derive`), then
  runs the real `--dry-run` and greps the rendered preview for an actual `<@…>` mention. Verified live:
  dropping `slackBot.selfUserIds` from the fixture turns the probe's exit 0 into exit 1.
- `live-turn-checklist-freeze-recurs-and-progress-accuracy` — the door was `turn status`, which refused
  `--tier fresh-visible-session` BY NAME, freezing a dispatched worker's checklist the moment the dispatcher's
  own sweep stopped believing in it. The probe runs `turn status --tier fresh-visible-session --dry-run`
  (the dry-run that doc added) against a fixture brief and asserts it exits 0 rather than refusing the tier.
- `review-loop-rounds-on-unrequested-scope` — no CLI door exists for this one (the fix lives inside the
  reviewer packet a `turn review` spawn composes, and spawning a real reviewer session is not a cheap probe).
  Its `probeWaiver:` explicitly asked for "a reviewer-loop test asserting the delivered-what-was-asked check
  runs first and rounds on self-assigned scope are capped" — which already existed as a real, passing test
  (`review/packetRounds.test.ts`'s `reviewerPacket rounds` block) that nobody had pointed the doc at. The probe is that
  test file, run directly: `yarn vitest run --passWithNoTests=false src/__tests__/unit/live/turn/review/packetRounds.test.ts
src/__tests__/unit/live/turn/reviewRounds.test.ts`. **The lesson generalises**: before writing a new probe,
  check whether the fix already has a real test proving the behaviour — the gap is often that nothing pointed
  the doc at it, not that nothing exists.

Not every door has a cheap dry-run to probe. `door-dry-run-behaviour-probes` audited every write verb this
skill and `turn`/`github`/`linear`/`slack`/`gmail`/`notion` cover and added one to `turn status` and `handover
finish` where it was missing and cheap; `turn answer` stayed without one — its send is threaded through gates,
a live thread-freshness re-read and workspace teardown deeply enough that a preview would need to duplicate
most of the effect path rather than skip it, which is not "cheap". Audit before assuming a `--dry-run` exists.

## Where the rule fires, and where it only warns

`handover finish`, `handover lint` and `handover check` REFUSE. `handover start` WARNS, as
`open-run-declares-no-probe`, printed last so it is the final thing a session reads before it begins.

**Why start warns rather than refuses.** MEASURED by walking `$SLOPWEAVER_HOME/handovers/*.md`
through `parseHandoverDoc` and `behaviouralProbeGap`: a refusal at `start` would stop **158** of the board's
301 `ready` docs — 88 declaring no `doneWhen:` at all and 70 declaring only structural probes, with a further
65 waived and passing. That does not enforce the rule, it stops a fleet mid-flight and demands 158 waivers
from authors who have not yet investigated the work. `finish` refuses, the transition the rule governs;
`start` tells you when the work opens, where a probe is the thing that decides what to build rather than a
retrofit.

A waived doc prints one line at `start` too. A waiver nobody ever sees again is the silent `done` the rule
exists to make visible.

## A lifecycle verb probes YOUR worktree, not the doc's `repo:`

`start`, `finish`, `resume`, `amend` and `sign-off` resolve a doc's probes — declarative targets and
`command:` alike — against the linked worktree the session is standing in, whenever that worktree's main
checkout IS the doc's `repo:`. Every other shape falls back to `repo:` unchanged: standing in that checkout
itself, standing in a worktree of a different repository, standing outside a repository at all
(`classifyProbeCheckout`, `src/handover/probeCheckout.ts`). When it substitutes, the verb prints the line
naming both trees — a probe that passed against a tree you did not expect proves nothing you can check.

MEASURED, and still reproducing: a `command:` probe running `yarn validate` in the
MAIN checkout inherits whatever machine-local state is sitting there, and no session can fix it from its own
worktree. `register-hygiene` anchors on the module it loaded, so from the main checkout it reads
`currentBranch: main` and counted **62** board docs — other sessions' rows, mostly a missing `artifact:` —
as blocking; the same gate in a linked worktree prints those 62 as advisory and exits 0. `coverage-ratchet`
reads the gitignored, per-checkout `coverage/coverage-summary.json`, and the main checkout held a partial one
at 1.03% branches against a 66% floor. That run's `finish` had to be forced with `SLOPWEAVER_ALLOW_UNREVIEWED=1`
naming both. Reproduce either half by running its entry point in each tree:

```bash
yarn --cwd <main> tsx <main>/src/devLint/registerHygiene.entry.ts   # exit 1, 62 blocking
yarn tsx src/devLint/registerHygiene.entry.ts                       # exit 0, the same 62 advisory
```

**The board is deliberately NOT substituted.** `handover list`/`run` and the `register-hygiene` gate probe
EVERY doc on the board, including other sessions' rows, and this session's feature branch is the wrong tree
to answer those from — a board reading every row off one branch reports about work that branch has not
merged. The substitution is for the single-doc verbs, which probe the one run this session holds.

## An absolute probe target is a parse refusal, not a probe

A `path:`/`present:`/`absent:` target resolves against the checkout above, and `insideRepo`
(`src/handover/evaluate.ts`) DECLINES an absolute one before any read happens, so as a probe it would read
as an ordinary unmet one — indistinguishable from a file that is genuinely not there. MEASURED:
three docs on the board carried one, and all three read as silently false.

It carries no waiver, because it is doc rot with a mechanical fix. Make the target repo-relative, or — when
the deliverable really does land outside that repository — use a `command:` probe, which is not resolved
against the repo at all.

## A `command:` probe runs inside a 30-second budget, so a whole-suite gate is the wrong shape

`COMMAND_PROBE_TIMEOUT_MS` (`src/handover/commandProbe.ts`) kills a probe that runs past it, and the probe
then reports `TIMED OUT` with that budget, prints `–`, and counts as unexamined — neither a pass nor a failure,
so `finish` will not close on it and never calls it a failure. MEASURED: a `yarn lint` probe
ran past the budget, `yarn` trapped the `SIGTERM` and exited 143, and `finish` printed `command exited 143` as
a failed probe on a tree where the same command had passed minutes earlier; the seat forced past it.

`yarn lint`, `yarn validate`, `yarn typecheck` and an unscoped `yarn test:unit` are CI's jobs, not a probe:
they re-prove the whole repository, take longer than the budget, and would stay green if the doc's own claim
went false. Probe the ONE consequence the work changes — a scoped test file, a verb's `--dry-run` output, one
gate's own entry point (`yarn tsx src/devLint/<gate>.entry.ts`).

**That is a check, not advice.** `checkWholeSuiteGateProbes` (`src/handover/check.ts`) reports it on
`handover check` — the verb that verifies a doc before it is handed over — at the moment the probe is WRITTEN
rather than minutes later from a `--probe` run. `handover lint` does not run the body check at all (it reads
front matter and the behavioural-probe gate), so a board sweep is `handover check --doc` per doc. Its criterion is the invocation grammar rather than a list of slow names — which would go
stale, and could not travel to a doc whose `repo:` is another repository: **a `yarn`/`npm`/`pnpm` script run
with nothing after the script name**. One more token is the author scoping it, so
`yarn test:unit github/merge --coverage.enabled=false` and `yarn tsx src/devLint/<gate>.entry.ts` are silent
and `yarn lint` is not. It fires on ANY segment of a compound command, because a pipe does not shorten the
lap, and says nothing at all about a command carrying `$(…)`. It is a FINDING and refuses nothing: the
run-time reading is already honest, so the finding only tells the author sooner.

It names the budget as a RISK and never asserts this script will blow it, because nothing static can time a
script — measured over the whole board, `yarn hygiene` is one of the scripts it flags and runs in 5.4s. What
is always true is the SHAPE: a whole-suite gate would stay green if the doc's own claim went false. Measured
the same way: of 247 board docs carrying a `yarn`/`npm`/`pnpm` `command:` probe, it fires on 16, every one an
unnarrowed script name. Reproduce with `slopweaver handover check --doc <path>` over
`grep -rlE '^\s*-\s*command:.*\b(yarn|npm|pnpm)\b' $SLOPWEAVER_HOME/handovers/*.md`.
