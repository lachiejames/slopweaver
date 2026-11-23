# Waiting on a queue entry, and the change the head rollup cannot see

Bundled reference for the `github` skill, beside [merge-queue.md](merge-queue.md). Both halves follow from one
fact: the queue lands a commit built from the MERGED tip, which is neither your head commit nor the tree your
pull request's own CI tested.

## Wait on the pull request, never on git ancestry

The queue merges a REWRITTEN commit, so `git merge-base --is-ancestor <your head> origin/main` stays false
forever, even after the pull request has landed. MEASURED: a pull request merged and a waiter on
that predicate reported "not yet" for 18 more minutes. The failure is silent and looks exactly like a slow
queue, which is the state you were already expecting, so nothing prompts a re-check.

```bash
slopweaver github checks --number <n> --until merge          # ends on MERGED <ts> or CLOSED
slopweaver github read https://github.com/<owner>/<repo>/pull/<n> --json   # state, mergedAt
```

`github read` takes the object URL, never `--repo`/`--number`. Once it reads merged, find the landed commit by
its subject on `origin/main`, which carries `(#<n>)`.

Ancestry stays the right instrument for a stack, where nothing rewrites the commit:
[stacks.md](stacks.md).

## A change that widens a shared contract needs a lap on the rebased tree

The head rollup runs on your base; the queue runs on the merged result. They answer different questions and
only the second can merge. A change every caller must satisfy (a field made REQUIRED on a shared dependency
type, a parameter added to a widely called function) can be broken by a caller that landed on `main` after
your fork point, and nothing on your pull request shows it.

MEASURED on one change: `chromePinPath` was made required on `PlaywrightCliDeps` and the two callers that
existed at fork time were wired. A third, `notionAtlas/walkRun.ts`, landed afterwards, so the merged tree
failed to typecheck while the branch's own stayed green. The queue evicted the entry three times, each after
about four minutes in `AWAITING_CHECKS`, with no comment, no failed check and no event: the pull request sat
open, mergeable, head rollup `SUCCESS`. Two wrong hypotheses came before one rebased lap found it in one run.

So before enqueueing such a change, rebase onto the current base, `github push`, and let CI's `build` run on
that tree (`github checks --number <n> --wait`). That lap IS the read of the merge group; the whole-tree gates
are CI's, never a seat's ([merge-queue.md](merge-queue.md) § Enqueue DIRECTLY).

**Watch the ENTRY, not `merged`.** A wait on `merged` cannot tell evicted from still queued and times out
identically for both. `github enqueue --pr <n> --repo <owner/name> --dry-run` prints the entry the pull
request currently holds, and `github landing` reports a press whose entry is gone as `pressed-not-queued`
([landing.md](landing.md)).
