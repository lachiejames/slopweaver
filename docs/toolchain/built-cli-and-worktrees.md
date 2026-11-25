# The built CLI — `dist-cli/`, and why a stale one cannot be tested

Part of [Toolchain](../toolchain.md).

The owner's ask: a built CLI, rebuilt on pull by a git hook in every worktree, **with a staleness guard that
makes it impossible for an agent to test a stale build**. The second half is the whole point — a fast CLI that
answers from last week's source is worse than a slow one, because the answer looks right.

**Two emitters, two directories, and they never share one.** `yarn build` is tsc into `dist/` and its job is
diagnostics ([§ `yarn build`](build.md)). `slopweaver dev build` is esbuild transpile-only into `dist-cli/` and its job is
a CLI that runs: 4,166 files in about 1.4 s, followed by a smoke run of the entrypoint it just emitted, which
is what turns "files appeared" into "the module graph resolves". `dist-cli/` is gitignored and no gate reads it.

**`--out` must name a directory inside the checkout, and the verb refuses one that does not.** The emit is
transpile-only, so every bare specifier in it — `neverthrow`, `zod`, `yaml` — is resolved by node walking UP
to a `node_modules`, and only the checkout has one. Measured: `dev build --out "$(mktemp -d)"`
emitted 4,166 files that could not run. The refusal is at the flag rather than four seconds later at the
smoke run.

**Every provisioned worktree gets one.** `slopweaver worktree create` and `cmux spawn` emit it after the
install, by default, and § Worktrees carries why the `post-merge` / `post-checkout` hooks cannot be the ones
to make a FIRST build. **So does CI's `subprocess` job**, whose lane spawns the launcher: unbuilt, every spawn
was a cold tsx transform, and one file took 273.3 s of a 273.8 s lane (the step's comment in `ci.yml`).

**The launcher takes the built tree when there is one.** `bin/slopweaver` execs `node dist-cli/cli/index.js`
when both that entrypoint and its manifest exist, and `tsx` otherwise — 0.63 s against 1.37 s for the same
verb, measured on `slopweaver catalog`. The launcher's one exception is `dev build` itself, routed to source
with a printed line saying so, because it is the verb that rebuilds the tree the guard judges. Most of a stale
build's verbs reach source too, through the guard (below), and that substitution prints its line as well: every
switch from build to source is announced, because a silent one is where this mechanism could lie.

**The guard runs before any verb dispatch, and names the first file that moved.** `dev build` writes
`.slopweaver-build.json` beside the emit — every tracked non-test `src/**.ts` file with its size and mtime,
plus the root it was emitted from. `guardBuiltTree` (`src/builtCli/guard.ts`) re-scans that list on every run of
the BUILT CLI, and a stale one never answers: what it does instead is the paragraph below on running its
checkout's source. `SLOPWEAVER_ALLOW_STALE_BUILD=1` runs the stale build anyway and prints which tree the answer came from. **The manifest is written LAST, and removed FIRST**, which is what makes a failed build safe. `dev build`
clears `.slopweaver-build.json` before esbuild writes a single file and stamps it only once the smoke run
has passed, so a build that dies half way leaves a tree mixing old and new files with NO manifest beside
them — the launcher ignores it and the caller gets tsx. Stamping up front would have left the one state
the guard cannot catch: a current stamp over rubble. No
manifest at all means the guard did not run rather than that it passed — a `tsx` run has nothing to be stale
about. The recorded root is stored rather than derived because `--out` can name any directory, and deriving
it from the built tree's parent would scan whatever sits beside it.

**A stale build runs its checkout's source.** Every seat worktree is emitted a build when it is made, its first
edit to `src/` makes that build stale, and rebuilding is barred to a seat by the owner's no-local-CI ruling, so a
refusal cost a seat every verb in its own worktree. Instead, `src/builtCli/invocationGuard.ts` restarts the
process in place (`process.execve`, same pid and descriptors) on the source of the ONE checkout the manifest
names, under tsx's loader with no tsx wrapper (`src/builtCli/sourceRestart.ts`), and prints one stderr line
naming that checkout, the first file that moved and `slopweaver dev build` as what restores the fast path.
Stdout stays the verb's alone. Nothing old answers: the source IS the code being edited, and the line says so.
The source run cannot re-enter this arm: a process loaded from `.ts` never restarts on source nor
waits to restart on a build (`runsFromSource`), console child or not, so even a manifest written beside `src/` by `--out` draws the refusal, not a loop. Four cases still refuse
with the four-line escape-hatch shape: an unreadable manifest, a vanished checkout, a checkout whose own
tsx preflight, tsx loader or `src/cli/index.ts` is not a readable regular file (a directory there counts as
missing, because Node would only fail after the exec), and a verb that needs the built tree itself —
`desktop install`, `desktop update`, `desktop e2e`, `talk courier`, `supervisor tick-capture` and
`supervisor tick`, declared once in `src/builtCli/sourceFallbackPolicy.ts`.

**A console child waits out a pull's rebuild instead of running source.** MEASURED: a pull to the main
checkout left its build stale until the post-merge `dev build` finished, every console verb refused in that
window, and the root layout's `org show --json` refusing drew "Organisation required" over every console page
until a reload. So a child the console launches carries `SLOPWEAVER_CONSOLE_CHILD=1` (`site/lib/launcherQuiet.ts`),
and for it ALONE a valid manifest over a moved source is a rebuild in flight: `src/builtCli/invocationGuard.ts`
prints `WAITING_LINE` to stderr before it waits, so a wait is never silent, then
polls the manifest every 250 ms for up to 30 s, judges a text only when it changes, and once one judges fresh
**restarts the process in place** on the rebuilt entrypoint (`src/builtCli/restart.ts`, `process.execve`) —
nothing is ever dispatched from the stale process. No fresh build in 30 s, and it refuses as before, one line
longer. An unreadable manifest or a vanished checkout is never waited out, and an open hatch runs at once.

**`supervisor tick open` waits as the PARENT, never in each child.** MEASURED: one tick lost 39 of
its 50 serial readings to a landing's fast-forward of the main checkout, each child refusing `[stale-build]` in
turn. So the capture reads the built tree beside its binary before every reading (`src/builtCli/builtStateRead.ts`)
and waits out a stale one through the same poll, once; a reading that failed while a rebuild crossed it is taken
again on the fresh build (`src/cli/commands/supervisor/scratchBuildGate.ts`). A wait that runs out is the last
that capture makes, so a rebuild that never lands costs one bounded wait, and the children's guard is untouched.

**The tree is `src/builtCli/`, and the name is load-bearing.** `tsconfig.json` excludes `**/build`, so a
`src/` directory named `build` is invisible to the Program: not typechecked, and not seen by
`named-object-params`, the one gate that needs resolved types. Nothing fails; the files are simply not
there, and the gate reports a file it can see in the working tree but never loaded. Never name a `src/`
directory `build`, `dist` or `coverage`.

**The same list excludes `**/dist-cli`.** The esbuild tree is a second emitter with a second name; left in,
`yarn typecheck` and `yarn build` read its 4,189 emitted `.js` files and answer with thousands of TS7031s,
on the machine of whoever ran `dev build` and never in CI, where no job builds one.
`src/__tests__/subprocess/builtCli/staleGuard.test.ts` is the end-to-end witness: it emits this repository, runs
the artifact, mutates ONE stamp in the manifest and asserts the source restart's one stderr line with stdout
byte-identical to the fresh run's, and the refusal of a verb that needs the built tree — and, as a console child,
restores the stamp mid-wait and asserts the restarted answer. Its emit lands under the
gitignored `/.cache/` rather than in the temp sandbox, for the resolution reason above.

## Module resolution — `#lib/…` rather than a relative climb

`package.json` declares one Node subpath-import root, `#lib/*` → `./src/lib/*`, so a module under `src/lib`
is reached by the same string from every file at every depth. The mechanism is Node's own `imports` field
rather than tsconfig `paths`, and that was measured rather than preferred: `bin/slopweaver` execs an ABSOLUTE
entry path from wherever the caller happens to stand, tsx discovers a tsconfig from the CWD, so a `paths`
alias dies with `ERR_MODULE_NOT_FOUND` for every caller outside the repo root, and all four vitest lanes
would additionally need `vite-tsconfig-paths`. `src/lib/subpathImports.ts` carries the four-row probe, owns
the root list, and states the one cost this accepts — `dist/` output is not independently runnable,
which nothing here depends on.

The root list is mirrored in that module and pinned to the manifest by
`src/__tests__/unit/lib/subpathImports.test.ts`, so a reader that walks import specifiers cannot be narrowed
by someone adding a root and forgetting it — `src/devLint/homeCallSites.ts` is that shape, and resolves
through the same list. `src/__tests__/subprocess/lib/subpathImports.test.ts` runs the shipped
launcher from a foreign working directory, which is the only place that property is observable.

Most of the tree still climbs relatively. Converting it, and the `subpath-imports` gate that would then
refuse a new relative specifier into a declared root, are follow-up rows in that order — a gate landing
before the conversion would need a baseline naming nearly every file here.

## Worktrees

One door, `slopweaver worktree`, so no session hand-rolls `git worktree add` and then wonders why its gate is
red:

```bash
slopweaver worktree create <slug> [--base <ref>] [--branch <name>]   # create (or reuse) + install + dist-cli
slopweaver worktree create <slug> --no-install                       # a worktree nothing will be RUN in
slopweaver worktree create <slug> --build                            # ALSO run `yarn build` (tsc into dist/)
slopweaver worktree create <slug> --no-dev-build                     # skip the built CLI, run from source
slopweaver worktree create <slug> --deps shared                      # link the plugin's shared tree instead
slopweaver worktree list                                             # every worktree, and the branch each holds
slopweaver worktree status <slug>                                    # branch, base drift, and the deps verdict
slopweaver worktree remove <slug> [--force]                          # retire one, git's own refusal intact
```

Defaults are `--install` on, `--deps own`, `--build` off and **`--dev-build` ON**. The two build flags name
two different artifacts: `--build` is tsc into `dist/` for diagnostics and nothing here needs it, while the
built CLI (`dist-cli/`) is what every verb run in the worktree afterwards actually executes. `--deps shared`
stays available for a throwaway read-only worktree and **refuses** when that worktree's `yarn.lock` differs
from the shared tree's. The shared tree is the plugin's RUNTIME install (`scripts/plugin-install-deps.sh`,
`dependencies` only), so it runs verbs and carries no lint, test or format tooling. The
**runtime-dependencies** lint gate (`src/devLint/runtimeDependencies.ts`) keeps that install whole: every
package `src/cli/index.ts` or `hooks/pretooluse.ts` reaches must be in `dependencies`. esbuild's metafile lists
each external import, static or literal-dynamic, and `RUNTIME_TOOLS` adds the five reached by a spawn, a package
script or `createRequire`. A computed load is its blind spot. `cmux spawn`
provisions its worktree through the same code and takes `--no-install` / `--build` / `--deps` /
`--no-dev-build` as pass-throughs.

**`--deps own` starts from a recycled tree when the repository's pool holds one.** The sequence is: claim
the newest pool entry whose `.yarn-state.yml` names this `package.json`, `yarn install` over it, write the
verified mark, privatise the exec inodes, emit. An install that fails over a claimed tree throws that tree into
the trash and installs once more from empty; one that cannot be thrown away is `RECYCLE_FAILED`, never a second
install over it. The report's `recycled:` line names the entry, or why none was taken — `pool-empty`,
`destination-present`, `contended`, `cross-device` and the rest of `RecycleSkipReason`
(`src/worktree/recyclePool.ts`). Every writer of a worktree's `node_modules` takes one per-worktree lock
(`src/worktree/depsLock.ts`): an own provision holds it from the claim through the verified mark and the
exec-inode privatisation, so nothing swaps the tree yarn or the privatisation is writing; `--deps shared`'s link waits ten seconds for it and then says who holds it; prune's drop of
a kept tree's dependencies declines rather than wait, and a removal refuses, holding the lock itself from the
move-aside to git's answer when it runs. A dead removal's batch goes back only under it, and `worktree remove`,
`worktree unshare` and the `post-merge`/`post-checkout` install refuse a tree whose lock is held, naming the holder. The lease never goes stale while its holder lives, since an install may
run twenty minutes. That lock lives in the repository's common git directory keyed by the worktree's ID,
never under a state home, so two sessions on two `SLOPWEAVER_HOME`s still contend on it, and never in the
worktree's admin directory, which a failing `git worktree remove` deletes mid-section. It guards the ROOT
`node_modules`; `desktop install`'s nested `desktop/node_modules` is no provision's. One writer still takes no
lock: `bin/slopweaver`'s one-time self-heal of a linked worktree with no `tsx`, which a shell launcher cannot
take it for (the module header has the gap and what would close it). Creating a worktree
holds a second, per-PATH lock in the same common directory (`src/worktree/addLock.ts`) from its
"nothing is here" check through a failed add's cleanup, so that cleanup never removes a second creation's tree;
it leaves a tree a reusing provision holds the deps lock on, removes a tree only one its own add registered — an
admin directory new since the add began, so a tree moved onto the path is never its own — and
otherwise clears nothing but an empty directory; a creation of a path another holds refuses.

**Provisioning makes the FIRST built CLI; the hooks keep it current.** Both halves of why the hooks cannot
make the first one are measured, not argued. `git worktree add` fires `post-checkout` before the new tree has
any `node_modules`, so the hook cannot boot at all — verbatim: `sh: node_modules/.bin/tsx: No
such file or directory`, exit status 127. And even with tsx in place, `postCheckoutPlan` skips a move whose
previous ref is the null OID, saying so itself: _"there is no previous commit to compare against — a new
worktree installs through `cmux spawn`"_. Reproduce the first half with:

```bash
git worktree add --detach "$(mktemp -d)/probe" HEAD   # and read lefthook's own summary
```

So `lefthook.yml`'s `test -f dist-cli/.slopweaver-build.json` guard does its job once provisioning has
emitted. Measured with no provisioning emit, ONE of 72 worktrees carried a build, so every verb
in the other 71 booted tsx — `handover list` 1.49 s against 0.92 s built, `catalog` 1.46 s against 1.13 s,
over 4,964 verb invocations in one day. The emit costs 91 MB a worktree and one build. It is **non-fatal**: a
worktree with no built CLI runs from source, so a failed emit is reported on the provision line and
provisioning continues rather than refusing to open the session that would repair it.

**It emits only into THIS package, and the report never outruns what it checked.** `worktree create --repo`
and `cmux spawn` both reach repositories that are not this one, so the target's `package.json` must name
`slopweaver` before its CLI is handed `dev build` — otherwise a foreign entrypoint gets an argument list it
never agreed to, and a foreign `tsc` writing into `dist-cli` would have the failed emit's cleanup pointed at
`--build`'s own successful output. Past that, `dist-cli emitted` is asserted off the ARTIFACT — the manifest
and entrypoint `bin/slopweaver` tests with `-f` — never off a zero exit. A failed emit's cleanup takes an
UNGUARDED tree as its subject rather than a failed attempt: a `dist-cli` still carrying its manifest is left
standing, because `builtCli/guard.ts` already polices it and a failure that never started the emitter (a
`tsx` present but not executable) cleared no manifest and is owed no tidying. Only an ESTABLISHED answer
moves anything: a stat that threw `EACCES` rather than `ENOENT` has said nothing, so an unreadable tree is
left exactly as it stands. Whatever the failure leaves — removed, guarded, unreadable, or standing unguarded
and unremovable — the line says which, and only a proven absence prints "runs from source".

`yarn lint` runs `slopweaver dev lint`, one door over every static-analysis check. It runs them ALL (no
short-circuit — one run tells you everything wrong) and exits non-zero if any failed. `--lane local` runs only
the checks flagged `offRepoState` — the five whose subject CI cannot see — and counts the gap in its own
verdict line, so a local green is never mistaken for the whole bar (see [§ Two lanes](rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis)). `--only <gate>[,<gate>…]`
narrows the same plan to the gates you name, for re-checking one finding without paying a whole lap; it
REFUSES a name that is not a gate, `--only` with nothing after it, and a selection the lane runs none of,
rather than quietly widening back to everything, and a narrow run says how much of the bar it was:

**No gate is `src/`-only.** The three `.claude/rules` files AGENTS.md § Code standards links are `paths:`-scoped
over `src/`, `eval/` and `hooks/`, and the gates that hold them are not — `jsdoc-tags` scans repo-wide. A file
outside those prefixes is still judged by every gate here.

**No gate is committed-only either.** Every gate's scan — and `src/hygiene/scan.ts`'s, and door coverage's —
lists the WORKING TREE through `workingTreeFilesOf` (`src/lib/gitRepo.ts`): every file git does not ignore,
committed or not. So a module you have just written is judged the moment it exists, and a scratch `.ts` left
under `src/` is judged too; `.gitignore` is the only thing that takes a file out of scope. Listing the
index instead lets a gate report CLEAN over work it never listed — that module header carries the
measurement, and `src/__tests__/subprocess/lib/gitRepo.test.ts` is the witness.

**That listing reads `-z` and trims nothing, because a path is BYTES and a line is not.** Git prints a
tracked path whose name begins with a space UNQUOTED, so a newline-delimited listing with a `.trim()` per
line turns ` probe.sh` into `probe.sh`, aliasing a different tracked file that every scan then reads twice
while never reading the offender. Measured with both tracked: `ambient-heap-ceiling` exited 0 while
`sh -c '. "./ probe.sh"'` gave a real `node` child a 320 MiB limit against a 4,288 MiB baseline. One
function feeds every gate here, so one trim would be the same hole in all of them;
`src/__tests__/unit/lib/workingTreeFiles.test.ts` is the witness, against real git rather than a restatement
of its output format.

```bash
slopweaver dev lint --only jsdoc-tags           # re-check one gate
slopweaver dev lint --only jsdoc-tags,house-rules
# dev lint: --only ran 1 of <the whole plan> gates, NOT the whole bar: jsdoc-tags
```

**Gates run as many at once as the machine holds, and the lap says so** — four at the 12,288 MiB floor `ci.yml`
asserts, eight on the larger runner, with a gate-time against wall-time witness on every lap. The pool, its
measured knee and what buffered output means for reading a lap: [dev-lint-pool.md](../dev-lint-pool.md).

Every gate is spawned under a **ten-minute ceiling** and each one's wall-clock time is printed beside its
tick, so the ceiling stays re-measurable from an ordinary lap. A gate that does not exit inside it is killed
and named — `✗ door-coverage (600.0s) — HUNG, killed at the ceiling` — and the lap CONTINUES, so one stuck
tool cannot hide what the gates after it would have found. This is not a hypothetical: MEASURED, a
`pre-push` lap sat inside `door-coverage` for 1h53m at 0% CPU with no output, was killed by hand, and passed
on the next run. Nothing in this repository was waiting. The `node` shim every gate is spawned through
resolves its own plugin from an OCI registry on **every** invocation, and that round-trip is unbounded:

```bash
time node --version                  # ~3.4s at ~3% CPU — the shim, not node
time PROTO_OFFLINE=1 node --version  # ~0.14s — the same node, no network
PROTO_LOG=debug node --version       # names the 3s gap: warpgate::clients::oci
```

Interleaved five spawns each way, twice, at load 13: **3,680 / 3,368 ms per spawn with the network,
139 / 136 ms without.** That cause is deliberately NOT fixed here — the shim is on PATH from the operator's
own dotfiles, not from anything this repository declares, so removing the round-trip is a change to a machine
rather than to a gate (an owner ruling, taken as its own decision). The ceiling is what this repo
owes regardless: whatever happens to that round-trip, the next unbounded wait will be in some other tool.
See `src/devLint/gateRunner.ts`'s header.
