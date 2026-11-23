# Base freshness — how stale your tree is, and when that refuses

Bundled reference for the `github` skill, split out of [pull-requests.md](pull-requests.md) when the
staleness advisory landed and the two halves stopped being one paragraph. **They are two different things**
and conflating them is the mistake this file exists to prevent: one is a NUMBER printed for you to read, the
other is a REFUSAL you have to answer.

## The advisory — how far behind the base you are, printed, never blocking

`push`, `stack push`/`pr create` and `merge` (with and without `--admin`) print one line above their verdict
when the count is non-zero:

```text
⚠ this branch is 7 commits behind origin/main
```

and print nothing at all when it is zero, so the common case adds no noise.

**Visibility, not a block.** A long-lived session runs a worktree its base has moved dozens of commits
past and nothing tells it, so it reports a defect that landed hours ago from reading its own stale tree. A hard block
for a worktree behind main hinders more than it helps, so the count is shown instead, in the
output the agent is already reading. So:

- **It changes no verdict and no exit code.** Structurally, not by convention: it is printed by
  `printBaseFreshnessPermit`, whose return value is the refusal signal, and the pure permit it wraps never
  sees it. Nothing branches on the number, and nothing may start.
- **It is silent wherever it cannot be honest.** A count that could not be taken prints nothing rather than
  a guess. `merge` against a LOCAL fallback base prints nothing either, because the number would
  UNDER-report — `base-unresolved` says the true thing there instead.
- **A shallow clone can inflate it**, for the reason `git merge-base --is-ancestor` reports a false negative
  inside the shallow boundary. Advisory only, so this costs a reader nothing; it is why nothing gates on it.
- **`github ready` carries no advisory.** It has no checkout and never fetches — it acts on `--number` from
  any directory — so a count printed there would describe whatever worktree you were standing in, not the
  pull request being readied.

## The refusals — `base-moved` and `base-unresolved`

**Every report is taken against the FETCHED base tip, and says which tree it read**, never the LOCAL ref.
Measured, every worktree on this machine trailed the remote — local `main` behind `origin/main` — and a guard measuring the local ref reported another session's landed pull request as an unmentioned 146-line deletion in yours, in a file the pull request does not touch:
16 findings against `main`, 15 against `origin/main`. So `github merge` fetches `<remote>/<base>` before it
measures anything, and opens with three lines — `measured in tree:`, `measured base:`, `measured head:` —
because the failure class here is _a verdict computed against the wrong tree, delivered in the voice of a
verdict about yours_, whose defining property is that you cannot tell it from a true one. When the fetch
cannot run at all, the local ref is measured and the report says so in those lines AND as its own
`base-unresolved` finding; `--acknowledge base-unresolved` accepts it when a stale local base is fine.

**`base-moved`** — before merging, the base branch is refetched from the remote and compared against the head
GitHub would merge. `--admin` BYPASSES the queue, so a base that advanced since your last push means you
would land on something CI never tested. `push` and `stack push` do not refuse it on a gated queue
([the merge hold](merge-hold.md)); `--acknowledge base-moved` accepts it when you have a reason.

What a rebase lap costs once the base has moved — the anchor order, a landing wave's conflicts, the deletions a
stale fork point hides — is [rebase-laps.md](rebase-laps.md).
