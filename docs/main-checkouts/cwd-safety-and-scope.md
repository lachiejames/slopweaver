# What a cwd may stand for

Part of [Main checkouts: current, installed, and honest about drift](../main-checkouts.md).

The declared set is also **the only repositories a verb may infer from its cwd**. `github search`, `github
checks`, `github review-state`, `refresh github` and every sibling that falls back to the cwd's `origin` when
`--repo` is absent resolve through `src/config.ts`'s `resolveRepository`, which REFUSES a cwd under
`$SLOPWEAVER_HOME` outright, and refuses one whose `origin` matches no declared main checkout's. Measured:
the state home is itself a git checkout
of a private state repository with no open pull requests, so a loop watcher running in a cwd nobody chose
searched it for three cuts and read a plausible `totalCount 0` every cycle — the verb named the repository it
had resolved on every one of those responses and nothing read it, so the fix is a refusal, not more printing.
An install that declares nothing has nothing to compare against and is allowed through; that is the fresh
onboard, before any profile exists.

## So a scheduled pass READS the declaration rather than standing anywhere

The refusal above is unconditional on the state home, and a scheduled pass's cwd is always a worktree under
it — `cmux spawn` takes no repository argument, so a seated session's worktree lands under whatever repo root
the SEATING session's cwd resolved to. So `refresh --source github` naming nothing can never succeed from a
scheduled pass, whatever the machine holds — measured, the `resync-corpus-github` row exited
non-zero on every tick with exactly that refusal (handover
`resync-corpus-github-can-never-succeed-run-due`).

The declared set is therefore also **which organisation a scheduled corpus resync crawls**. Org mode pulls everything from all repos across the org, because it is all useful context: everything
reachable is fetched into the store, including config that must not name identifying info in the codebase. So `src/live/resync/roster.ts` resolves the ONE distinct `origin`
OWNER across the declared checkouts and `src/live/resync/policy.ts` emits a single
`refresh --source github --store --all-repos --github-org <org>` step. Org mode's own
`resolveGithubOrg` answers the explicit org and returns before the single-repo arm ever reads a cwd.

Two properties of that resolution are the rule rather than a note:

- **More than one owner REFUSES.** Two organisations is a real configuration, and crawling one while
  silently ignoring the other is the same class of defect as a cwd guess — a subject nobody
  chose, reported as a success. The roster problem names both owners.
- **There is deliberately no `github.org` field.** Nothing in this repository writes the top-level
  `profile.json`, and the owner does not hand-edit config, so a field with no writer would be a convention
  rather than a mechanism. An organisation with no local checkout is what earns that field, with a verb to
  set it, as its own row.

An install declaring nothing gets a roster PROBLEM naming this remedy instead of a row that would refuse
itself in the small hours — read it with `slopweaver automation resync --list`.

## A child must never work in the shared main checkout

The declared set is not only what `checkout status` measures. It is also **what the guards protect**, and
what a spawned child is refused.

## The incident, anchored

During a ten-child dependency-bump batch: nine children worked in the worktree each was given.
The tenth worked in the shared main checkout instead, renamed its long-lived branch to its own feature name,
and committed on top. Its own commit was clean — one lockfile, 73 insertions, 881 deletions — but its PARENT
was the long-lived branch's head rather than the base branch's, so the pull request rendered that entire
branch against its base. Every check the child ran locally passed; nothing in the flow noticed until a parent
session read the pull request's diffstat and asked why a one-dependency change touched a whole tree.
Recovery was total and cheap (rename back, reset to `origin`), and the cheapness is the trap: it was
recoverable only because somebody looked.

The guard family DID refuse the child's later `git reset --hard`, and the child stopped and asked rather
than reaching for a break-glass — the behaviour these guards exist to produce, which is why none of their
refusals were relaxed to fix this. What it missed was the RENAME that had already done the damage.

## The four layers, and why no single one is enough

| Layer                                                              | What it catches                                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse` branch guard (`src/admit/mainCheckoutBranchGuard.ts`) | a `checkout`/`switch` off THAT checkout's own declared trunk, a `checkout -b`/`switch -c`, a `branch -m`/`-M` rename |
| `PreToolUse` dirty + edit guards                                   | a commit, a staged or unstaged write, a file edit                                                                    |
| `lefthook` pre-commit (`src/admit/mainCheckoutCommitGuard.ts`)     | a commit from a driving tool no `PreToolUse` hook sees                                                               |
| `slopweaver worktree here`                                         | the child's own check, BEFORE it writes anything                                                                     |

The first three are the fence, and a fence only ever speaks by refusing — one attempt at a time, after the
attempt. The child in the incident had already done the damage before it hit one. `worktree here` is the
sign: one command, run first, that says where a session is standing and what it may do there.

```bash
slopweaver worktree here          # exit 0 only in a linked worktree
slopweaver worktree here --json   # { standing, writable, facts }
```

Its refusal names the route out — get a worktree (`cmux spawn`, `worktree create`), or ask
(`slopweaver handover ask`) — because a blocked child with no typed way to ask is the untyped stop
AGENTS.md rule 6 exists to end.

## The doc is the fourth layer, and it is where the incident actually started

The instruction handed to those ten children told each of them to `cd` into the shared main checkout and run
a verb that resolves ONLY there — the package defining it lives on that checkout's long-lived branch and not
on the base a worktree forks from. Read literally, the instruction was correct, and that is the point: a doc
that hands a child a worktree and then hands it a command only reachable outside one has told the child to
leave. Two children reported the step independently.

`slopweaver handover lint` refuses a doc whose FENCED commands `cd` into a declared main checkout
(`src/handover/childStanding.ts`). Fenced only, deliberately — a doc recounting this incident has to be able
to name the instruction that caused it, and a rule that refuses the retrospective teaches authors to write
the history vaguely. The repair is a judgement, so `--fix` will not make it: state inline what the command
would have produced, or find a route that works from the worktree.

## What `cmux spawn` does, and what it deliberately does not

`cmux spawn` already opens the child's workspace with the worktree as its working directory, so a child is
standing in its own worktree from its first turn. It does NOT put that path in the pickup line, and that was
decided rather than overlooked: a path in a prompt is a fact a child can carry past the moment it stops
being true, while `worktree here` answers the same question from where the child is actually standing. What
the spawn's own success line carries is the directory it opened — the parent's only record of where a
child was stood up, and the thing missing when this incident had to be diagnosed from a diffstat.

## Explicitly out of scope

- A background sync daemon.
- Auto-rebasing a long-lived branch without a human.
- Refusing every spawn on any drift.

All three are overkill.

**One checkout is fast-forwarded without anybody asking, and it is not a fourth item.** The checkout a
session LOADS SLOPWEAVER FROM is fast-forwarded at that session's own start, by
`scripts/plugin-checkout-sync.sh` — one bounded fast-forward (`git merge --ff-only`, retried at most three
times while the branch stays a clean fast-forward) in the foreground of a boot, refusing
in every case `sync` refuses, on the one checkout that boot is about to read. Nothing resident, nothing in
the background, and no other declared checkout is touched. The reason: the owner
loads the plugin from a symlink to the owner's own checkout, so a checkout nobody moved is a session running
code that no longer exists, and the owner's sessions would run stale plugins. See
[docs/install-stays-current/routes-and-fixes.md](../install-stays-current/routes-and-fixes.md#the-owners-checkout-fast-forwarded-at-every-session-start) for the placement argument and the lock that keeps
it from racing a concurrent boot. This is the cheap, high-leverage layer instead: one verb that pulls and
installs as one act, one read-only check cheap enough to run every sweep, and one advisory that says what it
found.

## Where the pieces live

| Concern                               | Module                                             |
| ------------------------------------- | -------------------------------------------------- |
| The verdicts (pure)                   | `src/checkouts/freshness.ts`                       |
| Measuring a checkout (git + stat)     | `src/checkouts/inspect.ts`                         |
| The pull-then-install decision (pure) | `src/checkouts/sync.ts`                            |
| The spawn advisory's rules (pure)     | `src/cmux/baseFreshness.ts`                        |
| The verbs                             | `src/cli/commands/checkout/`                       |
| What the guards protect (two keys)    | `src/admit/declaredMainCheckouts.ts`               |
| What a cwd may stand for (pure)       | `src/config.ts` (`cwdRepositoryRefusal`)           |
| Where a session is standing (pure)    | `src/worktree/standing.ts`                         |
| `worktree here`                       | `src/cli/commands/worktree/hereRun.ts`             |
| The doc rule (pure)                   | `src/handover/childStanding.ts`                    |
| The plugin's own dependency mirror    | `scripts/plugin-install-deps.sh`, `bin/slopweaver` |

The mirror's freshness guard compares **both** `package.json` and `yarn.lock`: every direct dependency here
is exact-pinned, so a transitive resolution bump moves the lockfile alone. The mirror holds **runtime
dependencies only** (`yarn workspaces focus --production`), so a package the CLI loads or spawns at run time
is declared in `dependencies`; a checkout's own `yarn install` stays the full development tree.
