# The two failures this exists for

Part of [Main checkouts: current, installed, and honest about drift](../main-checkouts.md).

Both were measured on the same day, and neither was visible in any code review.

**A tree that no lockfile described.** A main checkout's `node_modules` had a transitive dependency hoisted
at a major version the lockfile had long since moved off. Every call through the resilience stack threw
before touching the network. CI was green the whole time, and correctly so: CI installs from the lockfile,
and the local tree does not. `yarn install` fixed it outright — a test file went from 4 of 20 passing to 20
of 20 with no source change.

The quieter half of the same finding: **there are at least two dependency trees per repository.** Worktrees
created by the plugin symlink `node_modules` at the plugin's own `cli-deps` mirror, which resolved the
correct version throughout. Only the main checkout's own tree was wrong. A green worktree therefore proves
nothing about the main checkout beside it.

**A base that was behind by exactly one commit.** A second repository's main checkout was one commit behind
its own upstream, so a session reading it did not know about something that had already landed. Nothing was
broken; the checkout simply was not current, and everything downstream inherited that.

## The owner's ruling, and the line it draws

A pull on a main checkout is followed by a `yarn install`, so `node_modules` reflects what the lockfile says.
Building on a base that is behind — fixes not yet landed, the wrong foundation because nothing checked it was
on the latest base — is a recurring cost. It cannot be fully solved without building a lot around it, and a
slightly drifted base is often fine depending on the change; but a change that depends on something in the
latest main must be on the latest base.

Two things follow, and the second is what keeps this small.

- The pull and the install are **one operation**, not two things to remember. A remembered second step is a
  step that gets skipped, and the skip surfaces somewhere else entirely.
- Drift is **reported, not refused**. A drifted base is usually fine. It matters when the change depends on
  what the newer base carries, and nothing can detect that — so the tool states the honest proxy and leaves
  the judgement to a person.

## Declaring your main checkouts

The set is configuration, in `$SLOPWEAVER_HOME/profile.json`, never a literal in this repository — it
differs per operator anyway, and a local absolute path has no business travelling with a shared,
team-facing tree.

```json
{
  "mainCheckouts": [
    { "path": "/abs/path/to/repo-one" },
    { "path": "/abs/path/to/repo-two", "rebaseOnto": "origin/<trunk>" }
  ]
}
```

- `path` — absolute path of the checkout's own main worktree.
- `upstream` — optional; the ref to measure "behind" against. Omitted means the branch's own tracking ref.
- `rebaseOnto` — optional; a **second** ref a long-lived branch is expected to be periodically rebased onto.
  It is also **the trunk the `PreToolUse` branch guard protects this checkout on**, with its remote prefix
  removed (`origin/staging` → `staging`); an entry that omits it is guarded on `main`. A literal `"main"`
  there inverts the guard for any checkout pinned elsewhere — MEASURED: switching a
  `rebaseOnto: origin/staging` checkout ONTO `staging` was refused while moving it OFF `staging` was not.

Declaring nothing is allowed and is reported as "none declared", never as a clean bill — an empty section and
a healthy one look identical, and only one of them means anything was checked.

## The verbs

```bash
slopweaver checkout status            # cheap: no network, no reference scan — refs as last fetched
slopweaver checkout status --fetch    # the THOROUGH pass (see below)
slopweaver checkout status --json     # the same verdicts, machine-readable
slopweaver checkout sync              # fast-forward, install if the pull requires it, refresh the console
slopweaver checkout sync --dry-run    # say what it would do, touch nothing
slopweaver checkout console --json    # the console's served build against HEAD and the upstream (the sidebar's)
```

## Three rungs, and why they exist

A measurement takes one of three depths, and the split is measured rather than preferred:

| Rung       | What it reads                                                                       | Who takes it                                  |
| ---------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| `cheap`    | local refs + three file stats                                                       | `doctor`, and `checkout status` with no flags |
| `current`  | also fetches, and reads the working tree (**~1s per repository**)                   | `checkout sync`, `cmux spawn`                 |
| `thorough` | also scans a rebase target's removed paths for local references (**~90s measured**) | `checkout status --fetch`                     |

`doctor` runs at every session start, so it takes the bottom rung — and **whatever a rung did not look at is
printed as unchecked, never as clean**: `working tree: not checked`, `(removed paths not scanned for
references — run \`slopweaver checkout status --fetch\`)`. An omission that reads like a clean bill is the
exact failure this whole document is about.

`status` exits non-zero when any checkout needs attention — behind, mis-installed, or unmeasurable. That is a
**finding**, not a broken tool, the same channel `doctor` uses, so a sweep can gate on the exit code.

`sync` refuses rather than improvises. A dirty tree, a detached HEAD, a branch tracking nothing, or a
`git merge --ff-only` that will not apply are all reported and left alone. A failed merge is **re-measured
before it is named**, because git fails a still-clean fast-forward the same way when another process in the
same checkout holds `.git/index.lock` (measured: 5 of 200 merges against a concurrent
`git status` loop, on a trunk every session boot also touches). Only a branch both behind and ahead of its
upstream is "diverged and needs a human"; one already holding the upstream is a success; one still a clean
fast-forward is retried, three attempts in all, then reported as transient with a re-run. It then installs
when either trigger fires:

1. the pull changed `package.json`, `yarn.lock`, `.yarnrc.yml` (at the root or in any nested workspace), or
   anything under `.yarn/patches/`; or
2. the tree was **already** stale before this pull — a previous pull nobody installed after.

The second trigger is the one that catches the measured failure. A sync that only looked at its own diff
would fast-forward a broken tree and report success.

Every run prints one line saying whether it installed **and why**, including when it did not, so a silent
absence is never mistaken for a decision.

## What `doctor` adds

`slopweaver doctor` prints the same per-checkout block at every session start, **without fetching** — it
runs constantly, so the free version has to stay free. Each block states how old the refs it compared
against are, so a "current" verdict never overstates its own evidence, and names `checkout status --fetch`
as the networked version. `doctor` itself still exits 0; the loud part is the text.

## How the install check actually works, and what it cannot see

The verdict compares mtimes: the last write to `package.json`/`yarn.lock` against the **later of two** marks
on the installed side — yarn's own `node_modules/.yarn-state.yml`, and
`node_modules/.slopweaver-install-verified`, which `checkout sync` and `worktree create` write after an
install that exited 0. That catches the measured failure exactly, because `git pull` stamps a pulled
lockfile with the pull's own time, so a pull that nobody installed after is visibly newer than its install.

**Why the second mark exists, and why it is ours rather than yarn's.** Yarn's state file moves when the
installed tree CHANGES, not when an install PROVES the tree correct — Yarn 4's node-modules linker writes
nothing at all when it has nothing to relink, and `.yarn/install-state.gz` does not move either. So a
lockfile stamped past that file by a fast-forward it already satisfies produced a verdict no install could
clear: STALE, `run yarn install --immutable`, install exits 0, STALE again. MEASURED, reproduced
in one command:

```bash
touch yarn.lock package.json && stat -f %m node_modules/.yarn-state.yml && \
  yarn install --immutable >/dev/null && stat -f %m node_modules/.yarn-state.yml
```

Both stats print the same number. Touching yarn's own file instead would make its mtime mean two different
things depending on who wrote it last, so Slopweaver records its own checkable fact — an install ran here at
instant T — inside `node_modules`, where removing the tree removes the claim about it.
`src/checkouts/installMark.ts` carries the whole finding.

The mark is never evidence on its own: `never-installed` still keys on yarn's state file alone, so a mark
beside a tree yarn never wrote is not an installed tree. And a `checkout sync` whose install SUCCEEDED but
whose mark could not be written says so on its own line and exits non-zero, rather than printing the STALE
verdict that would follow.

It **cannot** catch a tree corrupted without touching either file. `yarn install --immutable` is the only
answer that is certain, and it is the fix every stale verdict names.

## The second upstream: a long-lived branch that keeps drifting from its trunk

A branch that forked from a trunk which keeps moving needs periodic rebasing. The owner wants it generally
kept up to date — a judgement call on cadence, made by a person.

`rebaseOnto` makes the drift visible without acting on it, in two forms:

- **commits** the rebase target carries that this branch does not; and
- **stranded paths** — files the target _removed_ (a directory rename shows up here as a delete) that this
  branch still has _and still references in its own sources_.

The second is the one worth having. The measured case was a trunk renaming a scripts directory while the
long-lived branch still hardcoded the old paths: nothing is broken on the branch, and everything breaks the
moment it rebases. The examination is capped, and the report says how many removed paths it did **not**
examine — a silent cap reads as "covered everything".

It is also genuinely expensive: **measured at 90 seconds** on a real repository 92 commits behind its trunk,
which is why it runs only under `--fetch` and reports itself as unscanned otherwise.

## Base freshness at spawn

`slopweaver cmux spawn` measures the doc's `repo:` main checkout before it opens anything, and prints:

- the checkout's drift and install state; and
- when it is behind, **which of the paths the doc names also changed upstream** — its `doneWhen:` probe
  targets plus every backtick-quoted repo-relative path in its prose.

An overlap is the "your change depends on the latest base" case the ruling names. No overlap is the
"a little drifted, and fine" case, and it says so and forks anyway.

`--require-current-base` turns the advisory into a refusal on **any** drift. A caller who asks for a current
base has already made the judgement the tool declines to make, and answering that with "close enough" would
be the tool overruling them.

One thing the advisory is careful **not** to claim: a brand-new worktree is forked from the freshly-fetched
remote, not from the main checkout, so a stale main checkout cannot hand a new branch a stale base. What it
does affect is what the doc's probes read and what a bare `slopweaver` runs — and the advisory says that
explicitly rather than letting a reader infer the stronger, false version.
