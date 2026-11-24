# A `--rebaseline` keeps ONLY the entries your own branch moved

Part of [Toolchain](../toolchain.md).

Every ratchet gate in [the lint reference](lint-reference-repository.md) and [its second half](lint-reference-tests-and-ci.md) commits a debt list and refuses an entry that is new or grew; a `--rebaseline` run
rewrites that list from the tree in front of it. It does not know which of those entries **your branch**
earned. Tighten one your branch never touched, main lands work that regrows it, and the merged result is
refused by a floor only your baseline claims.

**No check on the pull request can report that, by construction.** GitHub's native merge queue builds a
throwaway ref — the base tip plus every entry ahead of yours plus yours — and fires `merge_group` on it
(`skills/github/reference/merge-queue.md`). The pull request's own rollup only ever tests your entry against
the base it was cut from, so a floor that passes there refuses on base-plus-entry, and the queue **drops the
entry in silence**.

MEASURED on one pull request: queued at position 1, dropped without merging; re-queued, dropped again.
`slopweaver github checks` read 10/10 with both required contexts present on the head throughout, and
`slopweaver github read` reported state `OPEN`, mergeable `MERGEABLE`, `mergeQueueEntry` none. The cause was
one line — `yarn tsx src/devLint/errorShapeThreshold.entry.ts --rebaseline` had tightened `src/store/backup`
from 22 to 15, which the branch earned, **and** `src/cli/commands/briefing` from 31 to 28, which it did not.
Main had since landed work returning briefing to 31. Reverting that one line left a one-line baseline diff
and the pull request merged on the next attempt.

So, after any rebaseline, read the baseline diff and **revert every entry your own branch did not move**:

```bash
git diff .baselines coverage-baseline.json    # every line here must be a file your branch touched
```

The rule is the class, not one gate, and the class is the block below. `internal-exports` is a member without
being computable as one — its `--rebaseline` writes the current unresolved set wholesale and carries no
refusal row for a check to find — so the block is bound to the refusal registry in BOTH directions by
`src/__tests__/unit/canon/ratchetGates.test.ts`: a gate that gains a rebaseline refusal fails the unit lane
until this block names it, and a name the registry no longer knows fails it too. A hand-typed list is how the
finding above reached the board naming five of the seven.

```text
# every gate whose --rebaseline rewrites a committed debt list
agent-doc-size
app-copy-voice
coverage-ratchet
duplicate-windows
error-shape-threshold
file-size-ratchet
internal-exports
no-silent-fallback
transient-references
unnamed-failure-assertion
untested-modules
```

## A baseline is judged against MAIN's copy, and a rise is a separate, witnessed act

Owner ruling: every ratchet but coverage judged the tree against a baseline in the
SAME tree, so one pull request could add a violation and raise its own baseline. The one implementing the pull
request must not be the one deciding to bump the ratchet. The rules and counts stay in the code; each allowed
exception is a BUMP RECORD in the state home (`$SLOPWEAVER_HOME/ledgers/baseline-bumps/`, beside the Codex
verdict on it), never in the tree, so a fork starts with the rules and none of that history. Three pieces:

- **`baseline-against-main`** (CI `lint`, `src/devLint/baselineAgainstMain.ts`) reads every file in
  `src/devLint/baselineRegistry.ts` at `SLOPWEAVER_COVERAGE_BASE_SHA` and at `HEAD` and REPORTS each row that is
  new or larger as a landing obligation: CI cannot see the home, so it cannot verify a declaration and does not
  pretend to. It refuses any file under `.baselines/`, whatever its depth or extension, that the registry neither
  judges nor excludes by name, so a new ratchet cannot arrive unjudged. Under `.baselines/bumps/` it passes a
  manifest the change adds (a landing CLI that predates the home reads a declaration only there, and the current
  landing verbs read it beside the home's records) and refuses a rewrite of one main holds, a record turned into
  a tree included, while one deleted passes. A change to a file in `BASELINE_POLICY_FILES` (the registry,
  the comparator, the store, the witness) that main already holds is itself a `policy` row, so the rules that
  judge a rise are witnessed like a rise. Run with no base it fails and prints the command that supplies one.
- **`slopweaver dev baseline-bump --reason "<why>" [--cwd <dir>] [--home <dir>]`** writes the record (one
  write-once file named for its digest) from the committed `HEAD` of the checkout holding `--cwd` (else the working
  directory), deriving each row's cause, and prints the one Codex review that witnesses it, its `--repo` that
  checkout and its `--home` the record's. The record binds no path, so the landing read's comparison decides what
  it covers. It names the main commit it was declared against, and that commit is in its digest, so
  the same rows declared again later get a record of their own. A second run with the same rows against the same
  base is refused, the first record's bytes untouched, since its reason is what a witness already judged.
- **`github enqueue` / `github merge --admin`** re-run the comparison THEMSELVES, against main and the merge
  landing would make (CI judges GitHub's merge commit, so a raw head is never the subject), read the home's
  records and any manifest the change adds under `.baselines/bumps/` (one digest, so one witness covers both
  copies), and refuse any loosened row no ELIGIBLE record with a qualifying witness covers. Coverage is per row, so an abandoned record
  beside a witnessed one holds nothing; a record declaring a row the change does not loosen, or naming a base not
  in main's history, is inert; one naming an older main commit counts only when its rows hold against that
  commit; a `widening` row must name a file the change leaves byte-identical to main. A store that will not read,
  or an ancestry git cannot answer, refuses. A native-stack member above the bottom is judged against the tip of
  the branch the whole stack lands on, since GitHub lands every unmerged member below it in the same press. The
  witness is a CURRENT, CLEAN adversarial Codex review (pass three) on the record's property id and exact claim
  for the head, read off both the ledger row and its record; a CURRENT BROKEN one on an eligible record refuses
  whatever stands beside it. `baseline-bump-unwitnessed` has no acknowledgement, and Codex capped means the bump
  waits ([pull requests](../../skills/github/reference/pull-requests.md)).

So a rise is: fix the code first; if the rise is right, commit the baseline, run `dev baseline-bump`, push, take
the witness it prints. A new row in `.baselines/file-size-tradeoffs.json` (a tradeoff the owner signed) and a
measured CI re-seed go the same way.
**The residue, stated:** a merge that bypasses both landing verbs (GitHub's own UI) lands a loosening nothing
checked, since CI only reports — the one door (AGENTS.md rule 3) covers it exactly as it does the pairing floor;
main moving, or the pull request's base being
retargeted, between the landing read and the merge (`merge --admin` pins only the head and refuses a retarget
only between its own two reads; the queue re-runs CI on the merge group, which is the PR's own gate code);
a landing verb run from the pull request's OWN
checkout, which runs that pull request's copy of the comparison (land from main's checkout and it is main's
code that judges); and a change to the WIRING — the gate's registration, the landing verbs' call sites — or
to a gate's OWN code, its cap or the path it reads its baseline from included, none of which
`BASELINE_POLICY_FILES` lists, so each is read by the pairing floor's review like any other code. A path
under `.baselines/` is the one exception the comparison closes itself: any file there, at any depth and of
any extension, that the registry does not name is refused, so a gate
repointed at a sibling `.yaml` never reads a file nothing judged.

## Two lanes: the local one is a secrets scan and a working-tree check, and everything else is CI's

**The criterion, by the owner's ruling:**

> A gate runs in the local `pre-push` lane if, and only if, **CI cannot see its subject.**

Not cost. Cost decides whether a gate should exist at all, never which lane it sits in: a gate CI can run is
CI's however slow it is, and a gate CI cannot run has nowhere else to go, so dropping it from this lane would
DELETE it rather than offload it. `checksForLane` (`src/devLint/devLint.ts`) filters ON the
`LintCheck.offRepoState` flag, so the lane is an **opt-in** and a gate joins `pre-push` only by declaring what
state a runner cannot reach.

**That direction is the whole of the ruling.** The lane had already been narrowed twice, both below, by naming the expensive gates, and both times it grew back, because an opt-out filter keeps every
gate nobody remembered to flag. MEASURED at load 13-15: `yarn lint:local` took 220.8s and 273.2s while the
repo-wide stack-operation lock (`src/admit/operationLock.ts`) was held ACROSS the hook, so unrelated sessions
serialised behind every push, and one seat's push was refused outright by a `node` crash inside a gate it did
not need. The owner's answer was to stop naming exceptions: aggressively offload work to CI, and leave the local lane
as a secrets scan and a working-tree check and nothing else.

| gate                     | the off-repo state it reads                                   | wall       |
| ------------------------ | ------------------------------------------------------------- | ---------- |
| `hygiene`                | the PRIVATE denylist, `$SLOPWEAVER_HOME/hygiene-denylist.txt` | 2.3 s      |
| `corpus-hygiene`         | the bronze corpus under `$SLOPWEAVER_HOME`                    | 41.2 s     |
| `register-hygiene`       | the handover register under `$SLOPWEAVER_HOME`                | 1.3 s      |
| `secrets-registry`       | the secrets store under `$SLOPWEAVER_HOME`                    | 1.5 s      |
| `derived-card-voice`     | the operator's private `profile.json` (voice half only)       | 0.4 s      |
| **the whole local lane** |                                                               | **43.5 s** |

Reproduce with `/usr/bin/time -p yarn validate:local`, and one gate with
`/usr/bin/time -p yarn slopweaver dev lint --only <gate>`. **Every other gate, `typecheck`, `test:unit` +
`coverage:ratchet` and `test:subprocess` are CI's.** `corpus-hygiene` is ~87% of the local lane, and its
subject is not what a push contains — so it is the obvious-looking next cut and it is the wrong one while
`pre-push` is the only trigger it has. Moving it to a scheduled row is the named next step, not a deletion.

## Why the heavy laps are CI's: two rulings

Owner ruling: whole-repo gates and test lanes do not run on the developer machine the whole
agent fleet also lives on. Raising the heap ceiling without cutting what the code needs only defers the cost: it
ends in fewer slots or kernel panics. So a heavy check runs on CI, and the machine watches CI instead.

### The same rule, reached on wall clock rather than memory

The same ruling reached again from the other end. The repo-wide stack-operation lock
(`src/admit/operationLock.ts`) is held across the `pre-push` gate, so a five-minute gate is a five-minute
repo-wide lock and unrelated sessions serialise behind it. Offered three fixes — rescope the lock per base
branch, put a bounded wait in the verb, or hoist the gate out of the critical section — the owner took none
of them. The heavy work moved to CI instead, watched with Slopweaver's own CI verbs, the most token-efficient
way to watch it.

**The lock is untouched by that answer.** Its critical section shrinks because the gate inside it got light,
which is why this section, and not `operationLock.ts`, is where that finding landed.

Those two narrowings named three gates — `named-object-params` (memory, a whole-repo `ts.Program`),
`prettier` (76.6 s, then the slowest gate in the lint lap) and `manifest-loader-tests` (31.1 s, the second
slowest) — plus `typecheck`, `test:unit` + `coverage:ratchet` and `test:subprocess`. Every one of them is
CI-only, and the opt-in inversion put the other ~40 ratchets beside them by inverting the filter rather than lengthening
the list.

**The offload added nothing to CI, because CI already ran all of it.** The `lint` job runs `yarn lint`
(the FULL lane, so it covers `prettier` and `manifest-loader-tests`) and the `typecheck` job runs
`yarn typecheck`: no CI time, no CI job and no extra turns, only a machine that stopped duplicating them.
**Hygiene stays local** — its denylist is private and exists only on this
machine, so CI cannot apply that half at all.

MEASURED on this tree, before and after the second split, with `time yarn <script>` on a busy
fleet machine. **Read the CPU column, not the wall column** — the two laps did not run under the same load
(97% CPU against 66%), so wall time flatters and then under-reports the change, while user+system does not:

| lap                                     | wall       | CPU (user+sys) |
| --------------------------------------- | ---------- | -------------- |
| `yarn validate:local` — before          | 300.4 s    | 291.4 s        |
| `yarn validate:local` — after           | 251.1 s    | **166.5 s**    |
| `yarn typecheck`, CI-only               | 52.1 s     | 48.9 s         |
| `yarn validate:local` — after inversion | **43.5 s** | **41.4 s**     |

**A push costs 124.9 s less CPU, 43% down** — and after the opt-in inversion (last row, measured with
`/usr/bin/time -p yarn validate:local` on this tree) **250.0 s less CPU than the original, 86% down.** Corroborating the ranking, each gate run alone with
`time yarn slopweaver dev lint --only <gate>`: `prettier` 96.2 s CPU, `manifest-loader-tests` 27.9 s,
against `jsdoc-tags` at 10.9 s for scale. Those three figures do **not** sum to the 124.9 s the lap actually
lost, and should not be quoted as if they did — each `--only` run re-pays yarn and tsx start-up that the
whole lap pays once, so they overshoot. They establish which gates dominate; the lap delta establishes what
was saved.

MEASURED on this tree for the FIRST split, one stage at a time under `/usr/bin/time -l` on a
busy fleet machine:

| stage                                    | wall        | peak RSS      |
| ---------------------------------------- | ----------- | ------------- |
| `lint` (full)                            | 531 s       | 3,617 MiB     |
| `lint:local`                             | 387 s       | 2,467 MiB     |
| `typecheck`                              | 47 s        | 3,257 MiB     |
| `test:unit`                              | 238 s       | 1,794 MiB     |
| `test:subprocess`                        | 389 s       | 379 MiB       |
| `coverage:ratchet`                       | 14 s        | 260 MiB       |
| **`yarn validate` — the old hook**       | **1,219 s** | **3,617 MiB** |
| **`yarn validate:local` — the new hook** | **444 s**   | **2,505 MiB** |

**That first split made a push cost 64% less wall time and 1,112 MiB less peak**, with the CI lap unchanged.
Reproduce a stage with `/usr/bin/time -l yarn <script>` and read `maximum resident set size`.

## What a green `validate:local` tells you — one sentence

**No secret is leaving, and the tree matches HEAD.** That is the whole of it. It does not cover the
named-options doctrine, any lint or house rule, formatting, manifest loading, **that the tree typechecks
at all**, either test lane or the MEASURED coverage floor. A type error, a failing test and a lint finding
can all reach `main`'s CI in one push.

That is the trade the owner asked for: push, then watch. And the cost is one
CI lap rather than one local lap — but do not discover it by surprise. `dev lint` prints the gap on every
run (`this lane ran 5 of 67 gates`), and the answer is to **watch `build`**; a session running a whole-tree
`yarn lint`, `yarn typecheck`, `yarn build` or a whole `vitest` lane (no file named, or a lane root) is refused by `whole-tree-check-guard` — a script name or a test lane only in a Slopweaver checkout, since the hook sees every project on the machine, and `tsc` or type-aware `oxlint` over a project anywhere — and
`prettier` checking anything but files, `knip`, and `dev lint --only prettier`/`knip`. **`yarn
typecheck` reads the ROOT `tsconfig.json`, and that config includes the whole tree** (the owner's ask) —
every `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.mts` and `.cts` outside `node_modules`, `dist`, `dist-cli`,
`build`, `coverage`, a dotted directory, `desktop` and `site`, with `allowJs` and `checkJs` on, so `eval/` and `hooks/` are
typechecked in their own right. An include list that names the TREE is why a new top-level directory is checked the day it appears rather
than the day somebody remembers to add it.

**The split that makes that safe: a wide config for CHECKING, a narrow one for EMITTING.** `tsconfig.json`
carries `noEmit`, and `tsconfig.build.json` extends it with `rootDir: ./src`, `outDir: ./dist` and
`include: ["src/**/*"]`, so `yarn build` emits exactly `src/` and nothing a widened check drags in can
change what ships. Each has its own `tsBuildInfoFile` under `.cache/`, because one shared incremental file
would make the two configs invalidate each other on every alternating run.

**`yarn build` still names its own memory ceiling**, even though the narrow config compiles strictly less than
the root: it is `bash scripts/tsc-owner.sh … --rss-ceiling-mib 10240 -- node_modules/.bin/tsc -p tsconfig.build.json`,
not a bare `tsc`, measured in [build](build.md). A bare `tsc` would also be refused by the `tsc-heap-contract` gate, whose criterion
reaches every package script naming the compiler and has no size exception by design.

MEASURED, and the only thing that settles it: the tree `tsconfig.build.json` emits is
BYTE-IDENTICAL to the one the old emitting root produced — 13,828 files each, `diff -r` silent. Reproduce
by building the base's own config beside this one and comparing, which is what that measurement was. Both
builds are `tsc` over a whole project, which `whole-tree-check-guard` refuses in a seat: run it in a human
terminal, or open `SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1`, whose named case is measuring the lap itself:

```bash
git show origin/main:tsconfig.json > /tmp/old.json   # then set its outDir to ./dist-old
yarn tsc -p /tmp/old.json && yarn tsc -p tsconfig.build.json --outDir ./dist-new
diff -r dist-old dist-new
```

`config/typescript/tsconfig.lint.json` still scopes the gate Program to `src`/`eval`/`hooks`, so
`named-object-params` scans that tree under its measured heap budget. It inherits `incremental`, `noEmit`
and `rootDir` from the root and keeps its own `tsBuildInfoFile`, which is load-bearing rather than tidy: sharing the root's would make the gate's
Program and `yarn typecheck` invalidate each other on every alternating run.

**`incremental` is on, and it buys a developer machine rather than a runner.** The root config carries
`incremental: true` and a `tsBuildInfoFile` under the gitignored `.cache/`, off the
`typescript-analyze-trace` profile. That profile's first
finding is a negative one worth keeping: **there is no slow file** — the worst single file is 6.6% of a
61.6 s cold typecheck — so there was nothing to optimise in the source, and the whole win is the cache.
MEASURED against that 61.6 s: warm no-change **23.9 s**, a leaf edit **19.8 s**, a hub edit **41.3 s**.
**In CI it buys nothing today**, and that is not a defect to fix here: each job checks out onto a fresh
runner with no `.cache/`, so every lap is a cold one until something persists that directory between runs.
Restoring it is the `ci-under-five-minutes` row's, not this one's. The same profile explains the
shape of the heap curve `named-object-params` measures: **11,926 of 18,811 loaded files are vendored
`.d.ts`, 8,666 of them from `@datadog/datadog-api-client`**, so the Program's size is mostly a dependency's
type surface rather than this repository's own code.

**The known residue, stated rather than discovered.** A NEW gate that reads `$SLOPWEAVER_HOME` and forgets
`offRepoState` runs only in CI, where it finds nothing to look at and prints clean — a silent green that
nothing here catches. `src/__tests__/unit/devLint/devLint/lintChecks.test.ts` and
`src/__tests__/unit/devLint/devLint/checksForLane.test.ts` pin the five-gate set in both directions, so a gate LEAVING the lane reddens; a gate that never joined it does not.

That is a real narrowing of the pre-push boundary, not a free win, and it is why `ci-offload-contract`
([below](lint-reference-tests-and-ci.md)) exists: the offload is safe exactly while CI still runs all five laps, so that is a gate rather than
a promise. **Watch CI rather than polling it**: `slopweaver github checks --number <n> --wait` blocks on GitHub's own
rollup with a stepped backoff and prints one status line, so the offload costs no extra tokens either. A
bare `gh pr checks` loop dumps full output into the session's transcript on every poll, which is the cost
the ruling explicitly ruled out.

`yarn validate` is the whole lap at a human's terminal; an agent session is refused it (above). It exceeds what CI
runs across `lint`, `typecheck`, `unit` and `subprocess` in **two** respects, both of them off-repo state CI
does not have: the private hygiene denylist, and the bronze corpus `corpus-hygiene` scans. Neither can be
moved to CI, and the mechanics of why — plus what that leaves unchecked — are in `docs/security/hygiene-gate.md`
§ "Where the private denylist actually applies". Two things run in CI and NOT in `yarn validate`, so neither
is a superset of the other: the coverage floor-integrity comparison, which needs a base commit only the CI
event supplies, and **`yarn build`**, which the `compile` job runs on every lap. Adding either to `validate`
would put a minute-long compile back on the machine the lane inversion took it off.

## The seat lane

A working seat runs `slopweaver dev lint --lane seat` before handback, and no other lane: it resolves its own
base, narrows oxlint to the changed files and names every whole-project gate it leaves out. What it does, and
why, is [the seat lane](seat-lane.md).
