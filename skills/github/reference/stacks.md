# Managing a native GitHub stack

`stack push`/`stack sync`/`stack adopt` ride GitHub's own native Stacked-PRs feature — GitHub's computed
stack is the membership and order authority, never a Slopweaver-owned ledger.

## `stack push` is the ONE verb that opens a pull request

The owner and the fleet's slopweaver tooling use the native GitHub pull-request stack verbs for every pull request
creation. `github pr create` is refused and prints a redirect here. **A
pull request is always a stack entry, single-PR stacks included**: a `target.base` naming the repository
default is the bottom of a stack of one, and GitHub's own stack object only comes into existence once
something is pushed on top of it — so that push reports `no registration needed` rather than minting a local
ledger that would then disagree with GitHub.

Everything plain `create` took, this verb takes:

- `--form <json|->` and `--file <path|->` — the same `PrForm`, as JSON or as a markdown+frontmatter
  authoring file.
- `--form-example` / `--file-example` — print the ADVISORY voice brief, then a complete valid one, and exit,
  touching no git, token or network. Run one FIRST if you have not filled this form before.
- `--self-review <json|->`, `--cwd`, `--remote`, `--home`, `--dry-run`.
- `--wait [--timeout-seconds <n>]` — hold at the repository's operation lock until the stack verb already
  running there finishes, rather than refusing with `another stack operation is in progress` and leaving you
  to retry the whole verb in a loop. A timeout prints that same refusal, naming the holding pid and its age;
  the lock's stale threshold (15 minutes) outlasts the 540s default, so a healthy holder legitimately can.
- `--acknowledge <a,b>` / `--acknowledge-all --reason "…"` — the creation gates below.

Every gate plain `create` ran still runs, in order, before the first API call: base freshness, already-landed,
the fleet-finding ruling ([pull-requests.md](pull-requests.md)). Then the token, ONE read of the branch's open pull
request (both description reviews name it), the door, the push, and the write-access preflight (`canPush`).

One behavioural difference worth knowing: **`stack push` amends and pushes the branch itself**, so there is
no separate `github push` beforehand. `github push` is for a branch whose pull request already exists.

## A chained pull request that is not a native stack is structurally impossible

Every stack is an actual GitHub native stack, and the class of problem where one is not is fixed structurally. An open
pull request based on another open pull request's head branch, without both sitting in the same native
GitHub stack, is refused at three doors (`stack push`, `pr retarget`, `github push`), reported repo-wide by
`github stack audit`, and failed in CI by `stack audit --check`. `stack adopt` counts what a rebase WOULD
leave rather than what GitHub reports today, so it never refuses the pull requests it exists to repair.
The whole class, its four shapes, each door's exact behaviour and the measurements behind them:
**[chained-stacks.md](chained-stacks.md)**.

```bash
github stack audit --repo acme/acme-admin --mine     # pairs involving a pull request you authored
github stack audit --repo lachiejames/slopweaver --check  # exit non-zero on any violation or a truncated walk — what CI runs
```

## Pushing a mid-stack entry carries the whole stack, or refuses by name

Pushing one pull request up in the middle of a stack always causes problems, so the stacking tool makes it
structurally impossible. **Both `github push` and `github stack push` run the same carry gate**, because
both rewrite the checked-out branch's commit and everything stacked on it is based on that commit.

Before it sends anything, a push of a branch that is an entry in a native stack reads what sits above it and
does one of two things, with no third option and no silent middle:

- **Carries them.** Every entry above is rebased onto its new base and pushed with an exact
  force-with-lease, bottom-up, in the same invocation — the same `rebaseSingleCommitOntoFreshBase` primitive
  `stack sync` uses, in the same order, with the same single-commit safety.
- **Refuses, naming each entry it would orphan and why.** Nothing is pushed at all — not the branch either.
  The reasons are `stack sync`'s own: an entry that is not exactly one commit, has no resolvable worktree, or
  is not registered in local stack state. Everything above a blocked entry is named too, since its own base
  will not move either.

```bash
github push --force-with-lease                       # carries the stack above, or refuses
github push --force-with-lease --orphan-above <n>,<n> # break-glass: accept EXACTLY those two being orphaned
```

`--orphan-above` is exact set equality, deliberately: it must name every pull request the push would orphan
and nothing else, so it cannot be typed by accident or left standing across a different push. The refusal
prints the exact list to pass. A `--dry-run` runs the gate too, so a preview discloses the same block.

**The carry stops at the first entry that does not land** — a conflict, a failed push, an unconfirmed
read-back — and reports what already went up. Entry N+1's base is entry N's head, so continuing past a failed
step would replay onto a base that was never written. A partially carried stack exits non-zero; it is never
reported as success. When a replay conflicts, the conflicting entry is yours to fix by hand: two of the four
entries above hit real content conflicts when one acme-admin stack was repaired.

**A clean carry is not the same as a correct one, and no gate can close that.** MEASURED on the same repair:
one of those two conflicts was a file being PROMOTED from `tests/e2e-next/` into `tests/e2e/` by the entry
above, while the base had meanwhile fixed a stale GraphQL operation name in the source copy. Replaying the
carried commit verbatim reintroduces the fix's absence in the destination file, and git shows no conflict
marker for it — the file it is merging is the one being deleted. A carry that stops on conflicts would not
have caught this; only reading what the base changed did. After a carry over a base that has moved, read the
base's own diff, not just the carry's exit code.

**Two things the gate does NOT do, stated so they are not assumed.** It does not retarget anything: removing
an entry from a stack still needs `stack remove`, and `pr retarget` and `stack remove` do not compose in
either order without a manual step (MEASURED — `stack remove --pr <n>` dissolved the stack and
could not re-form it, because the entry above still based itself on the removed branch, while `pr retarget`
refuses a stack entry and points back at `stack remove`). And it never frees a branch another worktree holds
— it rebases IN that worktree instead, which is why an entry whose worktree HEAD is not the commit GitHub
reports is refused at PLAN time rather than failing mid-carry.

**Cost**: one extra local read (the stack-member ledger) on every push, and — only when that ledger is
non-empty — one `findOpenPrByHead` plus one `getStack`. A repository nothing here ever stacked reaches no
network for this at all. Where the ledger IS non-empty and no GitHub token resolves, the push is refused
rather than sent blind.

**Why this was needed, MEASURED.** `github push --force-with-lease` moved the acme-admin pull request at position
1 of a native stack of five entries to a new commit and touched nothing above it;
all four entries above were orphaned. `stack sync` — the verb that would have carried them — had 13 records
in the whole door ledger against 2,364 `github.push`. The safe operation and the dangerous
one were two commands, and the dangerous one was shorter. Note also that **orphaning is an ancestry fact, not
a mergeability one**: right after that push only two of the four read `CONFLICTING`, while the other two
still read `MERGEABLE` because GitHub measures each entry against its own parent. The gate derives its facts
from `git merge-base --is-ancestor`, never from GitHub's verdict: ask ancestry "did this push orphan anything",
and keep `mergeable` for "can GitHub merge this right now".

## A peer's SHA is a base only once origin carries it

Every worktree of a repository shares one object database, so a commit a peer made LOCALLY
resolves from yours: `git cat-file -t <sha>` answering `commit` proves it exists, never that it is on origin or
still the head of anything. MEASURED: a peer named a commit as a stacked pull request's base, the
`cat-file` check passed, the rebase onto it was real, and the base was already dead because `main` moved again
before the peer's push landed. Take a base only once `git ls-remote origin <their-branch>` returns it, checked
yourself; while waiting, arm one Monitor on that remote ref changing rather than re-anchoring on every
announcement. The peer's own fetch, rebase and `stack push` belong in ONE bounded run,
which shrinks the window between "base is current" and "push lands" to the machine's floor.

```bash
github stack push --form - --dry-run
github stack push --form -
```

`stack push` amends the current commit, pushes it with an exact force-with-lease, opens the pull request from
the form, then registers it against the parent named by the form's `target.base` — creating a fresh stack,
adding to an existing one, or reporting that GitHub already joined it by branch topology alone, whichever is
true. `--dry-run` performs no effect at all: no amend, no door record, no push, no create, no network write —
it prints the exact body bytes, the real validator's verdict and the above-the-fold reading instead of
refusing on them, which is what makes it a preview rather than a second gate.

**It amends only the tree it was run over.** Before any gate or lock wait it pins what `git add --all` would stage
(scratch index); the amend commits only when the real add stages that same tree, HEAD unmoved. A tree already
HEAD's pushes HEAD as is; a real amend prints `amended <old> → <new>`. An edit made mid-push refuses naming the
paths, nothing committed or sent, the tree left staged; a hook re-staging (or the branch moving) inside the amend
refuses after it, HEAD amended locally, nothing sent. An untracked path HEAD's commit never touched, or one staged
out with `git rm --cached`, refuses too, dry run included; stage a new file first with `git add -- <path>`.

## `stack restack` restacks the WHOLE forest, locally, and pushes nothing

The whole restack happens on this machine, and only then does anything
get force-pushed. `stack restack` is that half — every OPEN pull request you authored, rebased onto its latest
base, bottom-up, in scratch worktrees, at any commit count, writing nothing to any remote. It is why `stack
sync`'s native-stack scope planned ZERO rebases over hundreds of registered pull requests across two
repositories. **[restack.md](restack.md)** carries the whole of it.

```bash
github stack restack --dry-run
github stack restack
```

```bash
github stack sync --dry-run
github stack sync
```

`stack sync` walks every native stack you're part of, repo-wide across every worktree (not just the one you
run it from — a rebase at the bottom of a stack has to propagate all the way up), and rebases any entry whose
base is no longer a git ancestor of its head — plus everything above it in the same stack — pushing each with
a fresh exact force-with-lease as it goes. It never trusts GitHub's own `base` field on a stack entry for
staleness; that semantic is unverified, so it derives staleness itself from git ancestry.

It refuses, per-stack, at the first entry it cannot safely touch — merged, not registered into local stack
state (via `stack push`/`stack adopt` — never GitHub authorship), without a single resolvable worktree, or
not exactly one commit (GitHub's own reported commit count decides that, never a local guess) — and reports
that as residue rather than failing the whole run: a problem with one stack must never block every other
stack sync would otherwise happily walk.

One thing worth knowing before you reach for `sync`: GitHub's own native stack **already** rebases every
dependent PR automatically once the entry below it merges — measured directly, not assumed. `sync`'s real
job is the case nothing native covers: an **open** entry gets amended or rebased while nothing below it has
merged yet — and the push verbs carry that case themselves, so `sync` is the repair tool for
a stack that ALREADY drifted (one orphaned before the gate existed, or one whose carry stopped at a
conflict), not a step you have to remember after every push.

```bash
github stack adopt --pr <number>                  # replay one commit onto its base's fresh tip, then register
github stack adopt --pr <number> --register-only  # register the membership only; rebase and push NOTHING
```

`stack adopt` pulls an **existing**, already-open pull request into local stack state and GitHub's own
native stack — it never creates anything. Its ordinary mode requires exactly what `stack push` already
produces and `stack sync` already trusts: one commit (GitHub's own reported count), checked out, matching
what GitHub reports as that PR's own head SHA. It rebases and force-pushes that one commit onto its base's fresh
tip with the exact same safe primitive `sync` uses, then registers it — locally into the ledger `sync`
discovers from, and natively against the parent named by its own base branch. It never retargets a base,
never inserts at a position, and never touches the description; those are simply not what this verb is for.

It refuses a foreign-authored pull request (override: `SLOPWEAVER_ALLOW_FOREIGN_PR=1`) and a dirty worktree
(override: `SLOPWEAVER_ALLOW_DIRTY_TREE=1`), and re-confirms the pull request has not moved between planning
and the door admitting the write — the same freshness discipline `pr update` uses. There is still no override
that makes the REPLAY run over a local HEAD that does not match GitHub's reported head SHA: that ambiguity is
exactly what corrupted this repository's history once already (see `stackSquash.ts`'s module doc). What the
three replay refusals — wrong branch checked out, more than one effective commit, mismatched HEAD — name
instead is `--register-only`, which selects a different operation rather than waiving this one. See
[chained-stacks.md](chained-stacks.md) § "A drifted chained pull request".
