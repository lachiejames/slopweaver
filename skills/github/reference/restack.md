# `stack restack` — the whole-forest local restack

A good pull-request stacking tool does the whole restack locally, then force-pushes it all to the remote at once,
so no one lands in a situation where the second pull request has been rebased and the third has not. The model is
Graphite's `gt sync` — restack every open pull request onto its latest base, stacked ones onto their latest
bases — and this verb is that half of it.

```bash
github stack restack --dry-run
github stack restack
```

Four things separate it from `stack sync`, and each is why `sync` planned **zero** rebases in both
repositories (hundreds of registered pull requests in one, dozens in the other —
reproduce with `github stack sync --dry-run` in each):

- **Scope is every OPEN pull request you authored**, read from GitHub, not the members of a native stack that
  local state registered. A pull request based straight on the trunk — which is not a native stack at all
  until something is pushed on top of it — is a root of its own tree and is restacked like any other. Every
  one of them was skipped by `sync` for exactly this.
- **A base branch is not a stack.** The unit is a TREE: two pull requests may share a parent, and the only
  ordering guarantee is that a parent is planned and moved before its children.
- **Each branch is replayed in a scratch worktree**, so it needs no checkout, and a branch checked out twice
  is not a refusal. On acme-admin that alone had stopped five of six stacks at position 1.
- **Any number of commits.** The replay is `git rebase --onto <new base> <old base>`, and the old base is
  known exactly rather than guessed — a child's is its parent's head as measured before this run moved it, a
  root's is its own merge-base with its base branch. The one-commit rule the other stack verbs carry is what
  made a stack UNREPAIRABLE once it drifted: GitHub counts a pull request's commits against its base, so
  orphaning inflates the count (one pull request read one commit before its base moved and three after), and
  `sync` then refuses precisely the state the drift created.

It writes nothing to any remote — it fetches, reads your open pull requests, and everything after that is
local. The result of each replay is staged at `refs/slopweaver/restack/<generation>/<branch>`, and your own
branch is moved onto it under a compare-and-swap when no worktree has it checked out; when one does, the
staged ref is named for you instead, since moving a checked-out branch under a working tree is not this
verb's to do. The refs are namespaced by GENERATION — one whole-forest replay — because a fixed per-branch
ref is silently overwritten by the next run, including one that died half way, so a reader could never tell
whose result it was holding.

Three things it refuses outright rather than half-doing:

- **A truncated inventory.** `listOpenPrsVia` walks five pages of 100 and says when it was cut short, so no
  caller reads a capped list as a complete one. A busy repository's open pull requests can
  sit within a page of the cap. A
  verb whose claim is "every open pull request you authored" cannot run on a walk that was cut short.
- **A pull request opened from a fork.** Its head branch is not on this remote, so `refs/heads/<head>` here
  names something else or nothing at all. Named as residue, never restacked.
- **Its own scratch worktree runs no repository hook.** A Codex review pass broke the "reaches no remote"
  claim with a counterexample it reproduced against a disposable bare origin: a `core.hooksPath` carrying a
  `post-checkout` hook that pushes gets that push run by `git worktree add`, so a verb that reaches no remote
  of its own still causes a remote write. Every scratch-worktree call points `core.hooksPath` at a path
  it never creates. `restackRealGit.test.ts` asserts the hook does not fire, and then that the same hook DOES
  fire on an ordinary checkout, so the witness is known to work.
- **A concurrent run.** The repository lock (`src/admit/operationLock.ts`) is taken BEFORE the fetch, the
  GitHub read and the plan — not just around the replay — because a plan built before the lock is a plan
  built from facts the run that held it may already have invalidated. A dry run takes it too: its fetch moves
  the same remote-tracking refs a real restack is planning from. Contention refuses immediately, naming the
  holding pid; there is no queue. The lock is per `$SLOPWEAVER_HOME`, so five worktrees of one repository
  serialise against each other exactly as long as they share a home.

## Every run publishes a snapshot of every open pull request of yours

Every open pull request of yours on the remote has local state tracking, which is as useful for a non-stacked pull
request as for a stacked one. Each real restack writes one to
`$SLOPWEAVER_HOME/live/github/pr-state/<digest>.jsonl`: a header naming the repository and this run's
generation, then one row per open pull request — its head as GITHUB reported it, its base's tip, what the
local branch points at, and whether it is `ready` (with the staged commit and ref), `unchanged`, or
`blocked` (with why).

Three properties are the whole design, and each is a rule rather than a note:

- **It is COMPLETE, and replaced whole.** A pull request that merged since the last run disappears by being
  absent from the next snapshot. That is the opposite of `ledgers/github-stack-members/`, which is one file
  per pull request and is never pruned — 227 stale rows there made `stack sync --dry-run` take 186 seconds
  to decide it had nothing to do. A run publishes even when NOTHING moved, for exactly this reason.
- **One unreadable row refuses the whole snapshot.** Skipping it would turn "every open pull request of
  yours" into "every one that happened to parse" at the moment [`stack submit`](submit.md) is deciding what to
  push.
- **The file is keyed by the repository slug AND the git common directory.** Worktrees of one clone share a
  snapshot, because they share the branches it describes; two clones of the same repository keep their own.
  Writes are one temp-and-rename, the shape `src/corpus/watermark.ts` already proved, so a lock-free reader
  never sees a partial file. The atomic write is not on its own enough against two concurrent restacks — the
  repository lock is what serialises those.

`remoteHeadSha` is what makes the next verb possible: a submit compares the live head to it and refuses when
someone else has pushed to your pull request, and only an explicit `--force` proceeds.

A conflict stops that TREE and nothing else: the rebase is aborted, the conflicting paths are named, the
scratch worktree is removed, and every other tree is still restacked. The exit code is non-zero unless every
planned branch moved.
