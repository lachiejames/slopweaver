# The stuck CodeRabbit re-request

The standing rule: if all threads are resolved but CodeRabbit is stuck still requesting changes, blocking the
owner's or the fleet's pull request from going green, re-requesting a review is the right call. Once the comments are
resolved and a good twenty seconds have passed without CodeRabbit switching from requested changes to approval, it is
probably stuck, and forcing that re-review is the desired behaviour under graduated autonomy.

So `github landing --press` re-requests the review itself before it leaves a row reading blocked on
CodeRabbit — **no card, no ask** (`src/cli/commands/github/landingCodeRabbitNudge.ts`; the pure half is
`src/review/codeRabbitNudge.ts`). The blessed act is `@coderabbitai review` posted on the pull request, which flips a stuck one green.

## What counts as stuck

The verdict `stuck` (`STUCK` in the table), computed by `src/review/codeRabbitVerdict.ts`: at least one
CodeRabbit thread, **every one resolved, outdated included**, neither threads nor reviews truncated, and CodeRabbit's
latest opinion CHANGES_REQUESTED, with its newest review of any state on the current head. The row's act
stays `spawn-coderabbit`. An unresolved outdated thread is still `changes-requested` — judge and resolve it
([coderabbit.md](coderabbit.md#the-flip)) — and so is a CHANGES_REQUESTED with no thread at all (nothing
was resolved), or one whose newest review names an older head (its review of the push is still to come).

Only the owner's own pull requests (`--author @me`) are candidates. An opt-out label, a draft, a conflict or red CI has
already won the landing ladder, so a stuck verdict under any of them is never re-requested over.

## Twenty seconds from WHICH instant

GitHub records no resolve time: a review thread carries `isResolved`, and no timeline item marks the resolve.
Any instant after the run's own fleet read came back showing every thread resolved is at or after the last
resolve. The press takes one on a monotonic clock as it starts its writes, once the whole read (queue reads
included) is done, and sleeps whatever of the twenty seconds is left, so the wait is never shorter than the owner's
twenty seconds from the real last resolve, and usually longer.

## What the press does

1. **Waits** the remainder of the twenty seconds, once for the whole batch.
2. **Re-reads** each candidate and re-derives its verdict from the fresh read. A moved head (a new push starts
   a new review), a reopened thread or a review list that did not come back whole posts nothing and reports `failed`, naming why; CodeRabbit approving the
   head by itself reports `flipped-by-itself`.
3. **Claims the head** BEFORE posting: one file per `repo#number@head` in
   `$SLOPWEAVER_HOME/landing-coderabbit-nudges/`, created exclusively, so of two concurrent passes exactly
   one wins it (a read-then-append register let both post). Before, because `github comment create`
   reports a failure when the post landed but its read-back did not. One head is re-requested **at most
   once** per state home, like every register under it; a bot still stuck after that is a session's to read,
   starting with CodeRabbit's latest review body.
   A register that exists but cannot be read nudges nothing rather than reading as empty.
4. **Posts** `@coderabbitai review` through `github comment create`, in process, so the door and its ledger apply.
5. **Records** an autonomy row, kind `nudge-coderabbit`, action id `<number>-<head7>-coderabbit-nudge`, and
   reports `nudged`. A ledger write that fails still reports `nudged`, and says the briefing will not show it.

A `nudged` or `flipped-by-itself` row leaves `--json`'s `dispatchable`, so no `coderabbit-loop` session is
seated over a bot about to flip; a refused or failed one stays. `--dry-run` waits and re-reads, then reports
`would-nudge` and writes nothing. The cap is **three re-requests per invocation** (`CODERABBIT_NUDGE_CAP`), so a
whole family stuck at once spreads over a few ticks. It is its own cap and never limits a merge press.
