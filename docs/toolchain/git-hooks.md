# Git hooks (lefthook)

Part of [Toolchain](../toolchain.md).

`lefthook` installs four hooks automatically on `yarn install` (via the `prepare` script); config in
`lefthook.yml`. Two are gates that refuse; two keep `node_modules` current:

- **pre-commit** — organises the _staged_ code files' imports (Biome: sort, merge, drop an unused one), then
  formats the staged files (Prettier — code and docs alike) and re-stages both, so every commit is already
  formatted + import-sorted the way CI checks. `piped: true` holds that order: Prettier may rewrap an import
  line Biome wrote. Each step's staged set is its CI gate's scope: Biome's is `biome.jsonc`'s extension list,
  so it keeps a glob; Prettier's is every file Prettier parses (`--check .`), so its command has NO glob and
  Prettier filters the staged list itself (`--ignore-unknown`, `.prettierignore`). A site `.mdx` page, a
  stylesheet or a config file is formatted at commit, never first caught by hosted lint.
- **pre-push** — refuses a working tree that differs from HEAD (`src/admit/prePushWorkingTree.ts`, named
  paths), then runs `yarn validate:local` (the local lane — see [the section above](rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis) for what it deliberately
  leaves to CI). `piped: true` plus the two `priority:` values are what hold that order: the gate reads the
  FILES ON DISK while `git push` sends the COMMIT, so over a dirty tree its verdict is about code the push
  leaves behind — measured on a pull request where an uncommitted typecheck fix would have earned a
  green gate for a red commit. Bypass in a genuine emergency with `git push --no-verify`.
  `slopweaver github push` (and the stack verbs) run this hook themselves, streamed, BEFORE opening the
  transport, and then push `--no-verify` with the gate already green: git's own order opens the ssh session
  first, and GitHub resets an idle one long before a slow gate finishes
  (`src/admit/githubPush.ts`, `pushAndVerify`). The local lane's 43.5 s is not instant, so the
  ordering matters. **An exit 0 is not a pass when the hook never ran a gate**: lefthook's generated shim
  prints `Can't find lefthook in PATH` and exits 0 in a checkout with no `node_modules`, so the verb reads the
  hook's stdout (replayed once the hook ends; stderr stays live) and REFUSES on that exact line, sending
  nothing (`src/cli/commands/github/prePushGateRun.ts`). Every OTHER route — a plain `git push`, and
  `github stack submit`, which pushes through git hook and all — is closed at the shim itself: `lefthook.yml`'s
  `rc:` makes the shim source `scripts/lefthook-rc.sh` before it looks for a runner, and that file exits 1 from
  `pre-push` when the checkout has no `node_modules/lefthook/bin/index.js` — the very path the shim itself tests,
  so a checkout that passes is one where the shim resolves a runner, and `yarn validate:local` could not run
  without it anyway. It touches no other hook: git hands post-checkout's status back as `git worktree add`'s
  own, before provisioning has installed anything. **What it cannot close**: the shim is generated and shared
  while `lefthook.yml` is per tree, and lefthook regenerates the shim from the config of whichever tree last ran
  a hook (measured: a `lefthook run` over a config with no `rc:` drops the line). A tree older than this file
  therefore strips it until a current tree runs a hook again, and a push from such a tree runs its own config.
  The verb's stdout check above is the layer that holds regardless. The shim also bakes in the absolute path of
  whichever lefthook binary installed it — a path that dies with a throwaway checkout, harmless now that the rc
  file, not that path, decides.
- **post-merge** and **post-checkout** — keep this checkout current with the ref it just moved onto, so
  nothing has to remember a second step. Each runs TWO commands, ordered by `priority:` because the second
  compiles what the first installed: `node-modules-current` then `built-cli-current`.
  `src/checkouts/refMoveBuildCli.ts` is the second, and it rebuilds `dist-cli/` when — and only when — the
  move changed a file the build reads AND this checkout already has a built tree; a checkout that has never
  run `dev build` is left alone rather than given one it did not ask for. **That is a MAINTAIN, never a
  create**: the first build of a worktree comes from `worktree/provision.ts`, for the two measured reasons
  in [§ Worktrees](built-cli-and-worktrees.md#worktrees) — this hook cannot reach a tree that has no `node_modules` yet, and its own planner skips a
  move with no previous ref. The first is
  `src/checkouts/refMoveInstallCli.ts`, which diffs what the move brought in, runs
  `yarn install --immutable` when — and only when — a dependency-defining file changed, then writes the
  verified-install mark and takes the native binaries back off yarn's shared inodes
  (`src/checkouts/install.ts` documents why all three steps are one operation). The owner asked for exactly this: a git hook that keeps the main checkout's
  `node_modules` up to date.

## What those two are keyed on, and what they refuse

**The trigger is the move's own CONTENT diff, never the freshness verdict.** `installFreshness`
(`src/checkouts/freshness.ts`) compares mtimes, and a ref move rewrites `package.json`'s mtime whether or not
its content changed — so a hook keyed on that verdict would install on every ref move forever. Worse, it
could not clear its own verdict: measured on the main checkout, a bare `yarn install --immutable`
after `touch yarn.lock package.json` moved neither `node_modules/.yarn-state.yml` nor
`node_modules/.slopweaver-install-verified`, and the gauge still read STALE. `dependencyPathsAmong` over the
diff is the predicate instead, and it already covers `.yarn/patches/**` and nested workspace manifests.

**They always print exactly one line** — installed, current, or skipped-and-why — because a silent hook is a
hook nobody trusts, and "I did not look" and "I looked and it was fine" are different claims. That is
structural rather than a convention: `renderRefMoveOutcome` is the only thing either hook prints through and
it collapses any line break it is handed, because a detail is usually text something ELSE authored —
`execFileSync` composes a thrown message as `Command failed: …` plus the child's output — and the entry point
turns every throw that reaches it into the `failed` arm rather than a stack trace.

**`.git/hooks` is shared across every worktree**, so these fire wherever the ref actually moved, a linked
worktree included. That is the intent: a worktree whose branch carries a different lockfile needs the same
install. What scopes them is the content predicate plus one refusal — a `--deps shared` worktree, whose
`node_modules` is a symlink into a tree every other such worktree reads.

**What they deliberately do not do**, each measured with lefthook 2.1.12: a file checkout, a `git checkout -b`
and a brand-new `git worktree add` all skip, with the reason printed; `git bisect` and `git stash` fire
neither hook at all; and `post-checkout` carries `skip: rebase`, because git fires it ONCE at the start of a
rebase against the commit it is about to replay onto. A squash merge is the one arm easy to lose —
`ORIG_HEAD` and `HEAD` are the same commit there, so `post-merge` compares the INDEX instead. git IGNORES
what either hook exits with, so a non-zero exit aborts nothing; it is what makes lefthook render a failed
install red in its own summary. Two worktrees moving onto lockfile-changing refs at the same instant run two
concurrent installs: the deps lock (`src/worktree/depsLock.ts`) is per worktree, so the hook refuses only a
tree whose own lock is held.

`tsconfig.json` is the strict config, and the WIDE one — `strict` plus
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`,
`noImplicitReturns`, `noUnusedLocals`/`noUnusedParameters`, `allowUnreachableCode:false`,
`allowUnusedLabels:false`, applied to every file in the tree rather than to `src/` alone.
`tsconfig.build.json` is the emit config that extends it. Standalone toolchain — TypeScript + vitest + Prettier + oxlint + knip + yarn constraints + lefthook, no
monorepo tooling.
