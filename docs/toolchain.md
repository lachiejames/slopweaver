# Toolchain

Every command, linter and hook this repo runs, and what each one is for: a per-linter reference needed
when a gate fails or a tool is added, not a fact every session must hold. `AGENTS.md` keeps the lines that
decide behaviour and links here for the rest.

Yarn 4 (Berry), pinned via the `packageManager` field and resolved by Corepack/proto. `node-modules`
linker (not PnP) for maximum tooling compatibility. Node version is pinned in `.nvmrc`.
Corepack reads `packageManager` from the CURRENT directory, so `cd` into the checkout before running `yarn`:
from elsewhere, `yarn --cwd <checkout>` starts Corepack's default Yarn 1 (`cd /tmp && corepack yarn --version`).

**Whether a machine meets these pins is `slopweaver doctor`'s first section.** Node is checked against
`package.json`'s `engines.node` floor, and the fix it names installs `.nvmrc`'s exact version with the manager
already serving `node` (proto is the recommended one). Yarn passes when `yarn` is on `PATH`, or when `corepack`
is, because the install runs `corepack enable`. A `corepack` that ships beside Node but is not on `PATH` (proto's
shims, for one) stays FATAL, because the install cannot find it by name. The fix names the exact binary to
enable. `git`, `bash` and Docker are fatal too (Docker when neither the Docker Desktop app nor a `docker` CLI is
present; a running runtime is not checked) — the local store is `supabase start`, which runs in Docker
(the owner rules it a required dependency for anyone who installs Slopweaver) — and `doctor` exits 3 on any
fatal miss. Everything else is a warning that names what keeps working without it: `slopweaver` on `PATH`,
`gh` and its two token fallbacks, cmux, `claude`/`codex`, and the pinned Supabase CLI (`package.json`'s
`dependencies.supabase` against what `node_modules` holds). The Datadog agent and the zsh profile are
reported as developer health and are never Slopweaver requirements. The default run starts no subprocess. `doctor --deep` adds `gh auth token`,
a knock on the cmux socket and `zsh -i -c exit` (the cost table is in `src/environment/gather.ts`). Onboarding
runs it first.

**`bin/slopweaver` finds its own Node before it starts one** (`hooks/lib/node-resolve.sh`), trying in order: `SLOPWEAVER_NODE` (an absolute path to a binary named `node`, settable in
`~/.config/slopweaver/env`), then `.nvmrc`'s exact version installed under proto, nvm, fnm, volta, mise or asdf,
then `node` on `PATH`. Each candidate has its `--version` read once against `engines.node`, and the chosen one's
bin dir goes first on `PATH` for everything the launcher starts. A pin that does not fit refuses, never passed
over; a broken `.nvmrc` install falls to `PATH` with a printed WARNING naming it. No fit at all is
`REFUSED [no-node]` — the floor, what each tier found and the install command — and exit 1. A checkout with no
readable floor, or an `.nvmrc` below it, is `REFUSED [node-contract]`.
The `claude seat --from-payload` fast path exits before any of this and starts no Node.

**Every checkout installs its OWN `node_modules`, and none is ever a symlink to a shared one.** That is the
owner's rule: one tree shared across checkouts silently unlinks a dependency only one branch declares
whenever a checkout without it installs, and that presents not as a missing package but as a gate reporting
`TS2307 Cannot find module` for code nobody touched, with the unit suite green. Create a worktree through `slopweaver worktree create` ([below](./toolchain/built-cli-and-worktrees.md#worktrees)) and the install is part of
creation; a worktree made some other way installs on its first `bin/slopweaver` invocation instead.

`.yarnrc.yml` sets `nmMode: hardlinks-global`, which is what makes that affordable — every file in
`node_modules` is a hardlink into one content-addressed store, so a worktree's own tree costs **316 KiB** of
unique blocks instead of **2.41 GiB**. Measured across 247 registered worktrees; reproduce with
`du -sch ~/.yarn/berry/store <worktree>/node_modules`, whose total stays at the store's own size.

**An own tree may START from a recycled one, and is still installed.** Bytes were never the cost; the link step
writing ~165k entries was — a fresh install measured 67.8s, 64s of it linking. So a removed
worktree's root `node_modules` goes to its repository's recycle pool instead of the trash, and the next
provision renames one in and then runs `yarn install`: yarn diffs it against its own `.yarn-state.yml`, and a
tree from a commit whose `yarn.lock` differed by 304 lines reconciled in 5.1s to the same tree a fresh install
produces, entry for entry and inode for inode. The verified mark and the exec-inode pass below run after it. `src/worktree/recyclePool.ts` carries the reproduction and the protocol.

**A NATIVE BINARY is the exception, and it is carved out rather than tolerated.** Sharing one inode across
every checkout means sharing a failure domain: yarn's own `copyFileViaIndex` rewrites a store entry IN PLACE
when the destination already links to it and the entry's `mtime` is not yarn's `SAFE_TIME` sentinel, and one
such write leaves that binary PERMANENTLY unexecutable — measured: 98 of 300 execs killed and
every exec after lap 203 killed, with byte-identical content, because macOS condemns the vnode's code
signature and never revalidates it. So each install ends by hardlinking every Mach-O image in the tree to
Slopweaver's own exec store instead (`src/worktree/execInodes.ts` carries the whole measurement). That store
holds one copy of each distinct binary machine-wide — **1.1 GiB total, not per tree**; a private copy per
worktree would have cost 353 GiB. `doctor` reports a checkout still on yarn's inodes and
`slopweaver worktree unshare [--all]` repairs one, or every worktree of a repository.

`bin/slopweaver` is the one launcher every route above eventually runs, including through the
`~/.local/bin/slopweaver` symlink a plugin install gets (see
[install-stays-current.md](./install-stays-current.md)). It resolves its own directory by walking any
symlink chain by hand first — a plain `dirname` on an unresolved link names the LINK's own directory, never
the target's.

The block below is the catalogue, not a seat's recipe: `lint`, `typecheck`, `build`, `validate` and an unfiltered `test:*` are a human
terminal's or CI's, and `whole-tree-check-guard` refuses them in an agent session, whose feedback is
`slopweaver github checks --wait` ([hooks](./hooks/registered-and-bounded.md)).

```bash
yarn install                # deps
yarn slopweaver doctor      # smoke-test the CLI end-to-end
yarn format                 # organise imports (Biome), then apply Prettier formatting (code AND docs) in place
yarn lint                   # `slopweaver dev lint` — the whole static-analysis bar (see the lint reference, indexed below)
yarn lint:local             # ONLY the 5 gates CI cannot see the subject of (see docs/toolchain/rebaseline-and-lanes.md § Two lanes)
yarn typecheck              # tsc over the ROOT tsconfig: the repo tree and desktop's unit tests; `site/` and the desktop shell have their own build jobs (must be clean)
yarn test:unit              # vitest, always with --coverage (must pass); off CI at most 4 forks (src/testLanes/unitWorkers.ts)
yarn test:subprocess        # real git-subprocess tests, off the pure-function unit bar (must pass)
yarn test:e2e               # the console's browser lane: Playwright over a built console and a seeded home (CI's `desktop-e2e`); specs are `src/__tests__/e2e/*.spec.ts`, never collected by Vitest
yarn validate:local         # lint:local alone — what the pre-push hook runs; every other gate is CI's
yarn validate               # lint + typecheck + the six unit shards in sequence, merged + test:subprocess + coverage:ratchet
```

- [The built CLI — `dist-cli/`, and why a stale one cannot be tested](./toolchain/built-cli-and-worktrees.md)
  - [Module resolution — `#lib/…` rather than a relative climb](./toolchain/built-cli-and-worktrees.md#module-resolution--lib-rather-than-a-relative-climb)
  - [Worktrees](./toolchain/built-cli-and-worktrees.md#worktrees)
- [Profiling a gate, a lane or a verb — before it needs a ceiling](./toolchain/profiling.md)
- [The lint reference — formatting, static analysis and repository shape](./toolchain/lint-reference-repository.md)
- [The lint reference — tests, coverage and CI contracts](./toolchain/lint-reference-tests-and-ci.md)
- [A `--rebaseline` keeps ONLY the entries your own branch moved](./toolchain/rebaseline-and-lanes.md)
  - [Two lanes: the local one is a secrets scan and a working-tree check, and everything else is CI's](./toolchain/rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis)
  - [Why the heavy laps are CI's: two rulings](./toolchain/rebaseline-and-lanes.md#why-the-heavy-laps-are-cis-two-rulings)
  - [What a green `validate:local` tells you — one sentence](./toolchain/rebaseline-and-lanes.md#what-a-green-validatelocal-tells-you--one-sentence)
- [The seat lane: what a working seat runs before handback](./toolchain/seat-lane.md)
- [`yarn build`, and the check that was named for one](./toolchain/build.md)
- [CI job timing is reported, not red](./toolchain/ci-timing.md)
- [The laps run in parallel, and `build` is their verdict](./toolchain/ci-workflow.md)
  - [The unit lane is six shard jobs, merged in `build`](./toolchain/ci-workflow.md#the-unit-lane-is-six-shard-jobs-merged-in-build)
  - [Every job that installs the root project restores it from a cache first](./toolchain/ci-workflow.md#every-job-that-installs-the-root-project-restores-it-from-a-cache-first)
  - [A CI job runs only on an event that could change its outcome](./toolchain/ci-workflow.md#a-ci-job-runs-only-on-an-event-that-could-change-its-outcome)
  - [The shape the rule takes here](./toolchain/ci-workflow.md#the-shape-the-rule-takes-here)
- [Git hooks (lefthook)](./toolchain/git-hooks.md)
  - [What those two are keyed on, and what they refuse](./toolchain/git-hooks.md#what-those-two-are-keyed-on-and-what-they-refuse)
- [Working beside a gate](./toolchain/working-beside-a-gate.md)
  - [A comment that demonstrates a pattern gate trips it](./toolchain/working-beside-a-gate.md#a-comment-that-demonstrates-a-pattern-gate-trips-it)
  - [Leave the tree alone while a gate runs](./toolchain/working-beside-a-gate.md#leave-the-tree-alone-while-a-gate-runs)
  - [Kill by id, never by a grep naming the pattern](./toolchain/working-beside-a-gate.md#kill-by-id-never-by-a-grep-naming-the-pattern)
