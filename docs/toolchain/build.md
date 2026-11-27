# `yarn build`, and the check that was named for one

Part of [Toolchain](../toolchain.md).

The owner's question: if CI does not build, what is CI actually doing — because a CI that lets things break
costs time instead of saving it. The required check is called `build`, and it is an AGGREGATOR — its one step is
`test "$ALL_SUCCEEDED" = "true"` over its workers' results. The compiler runs in its `compile` worker; the
only other caller of `yarn build` is `slopweaver worktree create --build`, off by default because "no verb
here needs one" (`src/worktree/provision.ts`). `yarn build` is in no `lefthook` hook and not in `yarn validate`.

It needs its ceiling. MEASURED: `tsc -p tsconfig.json` with no ceiling
died with `FATAL ERROR: Ineffective mark-compacts near heap limit` at 4,085.3 MB after 61s, exit 129. With
an 8192 MiB ceiling it finished clean — 18,785 files, `Memory used:
4,966,039K`, Check 27.38s / Emit 14.84s / total 60.04s, zero errors, 120 MB of `dist/`. Reproduce:

```bash
node --max-old-space-size=8192 node_modules/typescript/bin/tsc -p tsconfig.json --extendedDiagnostics
node node_modules/typescript/bin/tsc -p tsconfig.json    # dies at V8's own ~4,096 MiB default
```

That measurement is from a tree where `tsconfig.json` was BOTH the check config and the emit config.
`yarn build` reads the narrow one — `-p tsconfig.build.json`, which compiles `src/**` alone — and its emit
has since outgrown 8192: MEASURED on a later head, it died of `Ineffective mark-compacts`
at 8192 locally and in CI, and at 10240 finished clean — 25,637 files, `Memory used: 8,694,035K`, total
149.70s. So `yarn build` carries 10240, still under the 12288 MiB runner floor. `yarn typecheck` (`noEmit`)
carries 10240 too: MEASURED on main with the incremental cache off, 8,516 MiB,
and it died at 8192 on main itself (`ci.yml` § Typecheck holds the reproduction). Reproduce with
`yarn build --extendedDiagnostics`.

**Why the ceiling has to be enforced, not believed.** `tools/generateDatadogSurfaces.ts` records a
decision to hold two fields in a side table rather than on the row, because adding them "pushed
`tsc -p tsconfig.json` past node's DEFAULT heap ceiling" — a real design cost paid to stay under a ceiling a
session believed CI enforced.

Two mechanisms hold it, and neither substitutes for the other:

- **`compile`** in `ci.yml` runs `yarn build` as a parallel worker inside `build.needs`, so an
  insufficient ceiling or a compiler error reddens the required check. What it adds over `typecheck` is
  narrow and worth naming, because "the check config includes more files" does NOT make it a superset of
  diagnostics — `yarn typecheck` reads the ROOT `tsconfig.json`, which includes the whole tree
  and carries `noEmit`, while `yarn build` reads `tsconfig.build.json`, which is narrower in `include` and
  in `rootDir` and is the only one that emits. Emit-only:
  a source import escaping `rootDir: ./src` (TS6059, which the wider lint root admits), an output
  overwriting an input (TS5055), two inputs producing one output (TS5056), emit-dependent option validity,
  and the emission itself. It does NOT prove tsc's OWN output runs, and nothing does: `package.json`
  declares no `bin`/`main`/`exports`, `#lib/*` resolves into `./src/lib/*`, and no launcher reads `dist/`.
  The tree an operator actually runs comes from the other emitter — see [§ The built CLI](built-cli-and-worktrees.md), whose smoke run is
  where "it runs" is proved.
- **`tsc-heap-contract`** (`src/devLint/tscHeapContract.ts`) refuses a package script that runs the
  compiler without the bound the PINNED version needs, the policy chosen by `TYPESCRIPT_PIN` in
  `src/devLint/tscOwnerContract.ts`. At the 7.1 pin that is the compiler owner below, with a timeout, a
  grace of at most five seconds and an RSS ceiling, judged on every manifest that pins TypeScript; a V8 flag
  there is refused, because it bounds nothing native. `compile` proves a
  ceiling is ENOUGH; this proves one is still DECLARED. Its blind spot is stated in its own header: it reads
  script strings and nothing else.
- **`heap-ceiling-ratchet`** (`src/devLint/heapCeilingRatchet.ts`) proves the number never goes UP
  silently. Both 10,240s, the `named-object-params` argv ceiling and `HEAP_BUDGET_MIB` are pinned in
  `.baselines/heap-ceilings.json`; against `SLOPWEAVER_COVERAGE_BASE_SHA` a raise needs an appended record
  naming the anchor of the owner's word. CI cannot resolve that anchor, so a false record is findable
  afterwards rather than impossible. So the
  pins are a ratchet baseline too: a raised `ceilingsMiB` row also needs a bump record and its Codex
  witness ([rebaseline](./rebaseline-and-lanes.md)), which no record in the same diff can stand in for.
  An owner's `--rss-ceiling-mib` pins under the script's key plus `.process-tree-rss`, and is judged against
  the V8 ceiling it replaces, so moving a script onto the owner at the same number is no raise; the move is
  one-way, and an RSS key is still NEW to the registry, so the change that lands one carries a bump.

**Where the 4 GiB target stands.** MEASURED on TypeScript 7.1.0-beta, a cold cache, one run each under the
owner and its Go soft memory limit, its `peakRssKiB` the whole process tree: the typecheck peaked at 7,391 MiB
(`7568208`; 30,644 files, 16.2s) and the build at 8,156 MiB (`8351728`; 30,184 files, 21.4s) — the build
2,084 MiB under its ceiling. Without the soft limit the build was killed at the ceiling (`10542288`) over a live
heap of 6,452,427K; the compiler owner below says why. A project-references split cannot get a piece under
4 GiB today: `src/` minus its tests is ONE import cycle (`slopweaver catalog trees`), so it cannot be
referenced in parts. Reproduce the typecheck lap with
`bash scripts/tsc-owner.sh --timeout-seconds 1140 --grace-seconds 5 --rss-ceiling-mib 10240 -- node_modules/.bin/tsc --noEmit -p tsconfig.json --incremental false --extendedDiagnostics`,
and the build with `-p tsconfig.build.json` in place of `--noEmit -p tsconfig.json`.

**The compiler owner, for TypeScript 7.** `scripts/tsc-owner.sh` runs one compiler command as a process group
of its own, bounded by a timeout and by the group's summed resident memory (`--rss-ceiling-mib`, sampled every
100 ms), and reaps the whole group with TERM, a grace, then SIGKILL. It runs the command with `GOMEMLIMIT` at
70% of that ceiling: Go's collector otherwise lets the heap reach twice what the last collection kept, and that
garbage, not the compile's live heap, is what had the build at the ceiling. The limit is soft, so the ceiling
stays the only hard bound, and its cost is wall time (13.9s to 17.7s on one pair of runs). It reports `TSC_OWNER_START` and
`TSC_OWNER_RESULT` on stderr and maps each outcome to an exit status in its header. It exists because the native
compiler spends memory no V8 flag bounds and ignores SIGINT and SIGTERM (an open upstream TypeScript issue). Root
`build` and `typecheck` run under it at 10,240 MiB and 1,140 s, `desktop`'s `build` at 4,096 MiB and 540 s; each
`--rss-ceiling-mib` is pinned in `.baselines/heap-ceilings.json` under its script's key plus `.process-tree-rss`.
Its witness, `src/__tests__/subprocess/worktree/tscOwner.test.ts`, runs the installed compiler under it.
`runYarn`'s supervisor (`src/worktree/shell.ts`) TERMs a timed-out job's group and waits fifteen seconds before
SIGKILL. The owner refuses a grace past five seconds, so its worst case, that grace plus five seconds for SIGKILL to
land, ends first, and a `yarn build` cut off by its bound still lets the owner reap.

**One compile at a time, and none beside a lap.** Before it forks anything the owner takes this OS user's one
TypeScript compile LEASE, an operation lock (`src/admit/operationLock.ts`) at a fixed
`/tmp/slopweaver-<uid>/user-locks/` path, never HOME or TMPDIR, because a lap hands its lanes a throwaway home and a
sandbox sets its own temp directory. A lap takes the same lease after its lap lock and holds it for its whole run
(`src/cli/commands/github/lapCompileLease.ts`); the lap's own compiles are its descendants and inherit it
(`TSC_OWNER_LOCK mode=inherited`). MEASURED: Claude Code reaped three seats' jobs for low memory while one seat's
owner ran at its 10,240 MiB ceiling during a lap, the 16 GB machine reading 11.7 GB used and swap 2.9 of 4
(`slopweaver machine capacity --full`). A waiter says once who holds the lease and gives up after `--lock-timeout-seconds` (1,200 s when not given: one
root compile at its 1,140 s bound and its reap), counted from the first round that cannot take the lease rather than
from the owner's start, as `lock-timed-out`, exit 75, having run nothing; a lap waits the
same 1,200 s for a seat's compile, then refuses `COMPILE_LEASE_HELD`. A seat's compile started during a lap
therefore ends 75 rather than run beside it. In CI each job is its own machine, so the lease is never waited on.
Not covered: `named-object-params`' whole-repo Program (about 7.1 GB) runs under `yarn lint`, not the owner. The
witness is `src/__tests__/subprocess/worktree/tscOwnerLease.test.ts`, and the script's header carries the residue.

`slopweaver dev build` is over the same line, and no heap flag reaches it: it hands every `src` file to ONE
esbuild process, a Go binary that `--max-old-space-size` does not bound. MEASURED with no limit, one run,
`/usr/bin/time -l slopweaver dev build`: 4,947,853,312 bytes maximum resident, 15.7s. A seat on another branch
read 14,902,345,728 bytes the same way the same day; the two are not reconciled. An unbounded esbuild later grew
to about 28 GB and froze a machine running four seats; which process it was was never identified.

So that esbuild runs under the same owner (`src/cli/commands/dev/buildOwner.ts`): the compile lease, waited on
for at most 120 s (a lap's own build inherits it, witnessed in `tscOwnerLease.test.ts`), a 120 s emit bound, a
HARD 16,384 MiB group ceiling set above the larger measurement and well under the 28 GB event, and a SOFT
`GOMEMLIMIT` of 4,096 MiB (`src/lib/esbuildBounds.ts`) under the smaller one, so the collector does the real work
and a build that needs more slows rather than dies. The soft limit has not been measured under yet; once it has, the
hard ceiling can come down toward what it reads. A build refused on the lease, killed at the ceiling or failed any
other way prints ONE stderr line naming which, runs no smoke and stamps nothing. Neither caller fails on it: worktree
provisioning (`cmux spawn`, `worktree create`) keeps going and its report says the worktree runs from source
(`src/worktree/devBuild.ts`), and the `post-merge` / `post-checkout` hook prints that stderr line as its failed
clause (`src/checkouts/refMoveBuildRun.ts`). The seat then boots through `tsx`, as an unbuilt checkout always did,
after up to 120 s spent waiting. A non-lap build started during a lap is refused that way, because the lap holds the
lease for its whole run. The `runtime-dependencies` gate's
in-memory bundle starts an `esbuild --service` child too; its gate row sets the same soft limit in its `env`, and it
takes no lease. Both numbers are TypeScript constants, which `heap-ceiling-ratchet` cannot read: only their unit
tests pin them.

Free in WALL clock, not in runner minutes. The lap's critical path was the unit lane (p95 6:20, measured with
`slopweaver github ci-runs --branch any --event pull_request --runs 10`) and the compile is 60.04s
plus its own setup, so it finishes well inside the slowest leg while costing one more runner.

Every CI job carries a `timeout-minutes` ceiling: 20 for each of the five root workers, 10 for `site` and `desktop`, and 15 for `integration` in
`.github/workflows/ci.yml`, 10 for the `build` aggregator (one `test`, then the unit merge and the coverage floor) and 10 for
`dev-gate` in `.github/workflows/pr-body-gate.yml`. Each is sized from the
measured p95 of that job's last 30 green runs — see the file-level comment above `jobs:` in `ci.yml` for the
formula and the doored command that reproduces it (measured over 49 runs: `integration` p95
4m11s, `dev-gate` 1m00s). **The workers' 20 is PROVISIONAL** until each has a 30-run sample of its own; it
bounds a hang in any one of them. Without
this, a hung run reads running forever instead of failing, and a merge hold waiting on it goes stale rather
than red (measured: one pull request's `build` check read running for 68 minutes on a head every other check
had already passed). The `runs-on:` label is an **ephemeral GitHub-hosted runner**, and that is asserted
rather than described: each worker's `Runner facts` step reads `RUNNER_ENVIRONMENT` and fails the run if it
is not `github-hosted`, so the sentence you are reading cannot go stale without something going red.
