# A review thread's history in a description review

Child of [description review](description-review.md). No verb edits a posted inline comment, so a corrected
walkthrough is a new round, and that round resolves the previous one it owns in the same mutation
([self-review](self-review.md)). A review that read the old comment as live evidence would call the corrected one a
contradiction, so the packet shows each thread's history instead.

## What the reviewer is shown

Each inline comment in `evidence/pull-request-comments.json` carries `threadId`, `threadResolved` and
`supersededByThisWrite`. The last is true for every thread in the previous round the self-review ledger owns, and is
set only when this write posts inline comments (`src/outbound/github/descriptionReviewEvidence.ts`, which
`review-prepare` and the write's own check both call, so both see the same marks). A comment with either flag true is
history and never a check 1 refutation; one with both false is live, whoever wrote it. A ledger round that cannot be
trusted refuses the read, never reads as no round. A held self-review reservation or lock refuses it too, as
`SELF_REVIEW_RESERVED`: the round's own send refuses on that hold before resolving anything, so a superseded mark then
would hide a thread that stays live after the description goes out. A reservation never expires, so the refusal names
the way through: read the threads on GitHub, then `slopweaver github self-review release --repo <owner/name> --pr <n>
--head <sha>`.

## What is bound, and what refuses

Neither flag is in the digest (`existingCommentsDigestText`, `src/outbound/github/descriptionReviewCommentText.ts`),
so resolving a thread, or posting the round itself, voids no CLEAN review. Instead the receipt records the threads its
reviewer was told are history, and a write whose receipt names a thread that is live again, unresolved and not
resolved by this write, refuses `REVIEW_HISTORY_REACTIVATED` (`src/outbound/github/descriptionReviewHistory.ts`),
whether the receipt matched exactly or was carried, with no hatch: answer the comment in the description or the
outgoing comments, which makes a new packet. A thread reviewed as live that resolves later never refuses.

## Residue, stated

- A thread unresolved between the write's last read and its mutation is not seen, the same window a newly arriving
  comment has.
- A `pr update --self-review` that also edits the description PATCHes the body before the round posts and resolves,
  so a round its door then declines, or one failing mid-mutation, leaves a thread marked superseded live. The held
  reservation is the one such refusal knowable before the write, and the only one refused up front.
- After a BROKEN receipt, resolving a thread alone cannot earn a new review, since the manifest is unchanged.
- A reply by another person inside a thread the ledger owns reads as history once this write supersedes that thread,
  because the mark is per thread, not per comment.
