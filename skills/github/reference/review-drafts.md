# Reviewing somebody else's pull request

Findings reach the owner as draft pull-request comments on the relevant lines, approved from a Queue card the way a
Slack native-UI draft is. A review of a colleague's pull request goes
out under the owner's name, and an APPROVE can unblock a merge, so the review is parked before it is sent. It is never posted
on a session's own judgement.

## The flow

1. **Review before any reply.** A thanks, an approval or a "looks good" on somebody else's pull request comes after a
   review, never instead of one. Read the diff at its head, the base it lands on, and what CI ran.
2. **Codex plans and reviews.** Run the review as `codex review` passes over the pull request's diff, from a worktree
   checked out at its head, one falsifiable
   property per pass: _"a Revert on an booking task runs the transition guards"_, not _"review for
   correctness"_. When Codex is capped or no Codex plan is registered, `codex review-fallback` takes the passes in the visible session. Reproduce
   every finding before it goes on the card, because a confident, wrong comment under the owner's name costs more than a
   missed one.
3. **Park it.** Write the form and run `record`. The example below is illustrative, its repository, number and
   path all synthetic:

   ```bash
   slopweaver github review-draft record --repo acme/acme-admin --number <number> \
     --why "reviewed before the thanks reply" --form - <<'JSON'
   {"verdict": "COMMENT",
    "body": "I think this is close. Two things inline, neither blocking.",
    "comments": [{"path": "apps/billing/src/TaskTransitions.tsx", "line": 341,
                  "body": "maybe gate this on the task type, since Revert skips the guards here"}],
    "deeperReview": "the staging e2e suites were not run; running them needs the gcloud break-glass"}
   JSON
   ```

   It prints the card's console link and the one command the owner's yes becomes.

4. **Offer a deeper review when there is risk.** `deeperReview` names what this review did not settle and what would
   settle it. It is shown on the card and never posted. Leave it out when nothing was left unsettled.
5. **Post only on the owner's word**: `slopweaver github review-draft post <id> --approve <digest>`. On anything else, use
   `drop <id> --note "…"`.

## What `record` checks, and why each check exists

- **Somebody else's, open, unmerged.** It refuses the owner's own pull request (that gets a self-review walkthrough,
  [self-review.md](self-review.md)), a merged one and a closed one.
- **Every comment lands.** GitHub rejects the WHOLE review with a 422 if one comment misses. So each anchor must be on
  the head side of the diff, a context line or an added line. A range (`startLine` to `line`) must have every line
  addressable, which keeps it inside one hunk. A file the pull request does not change is refused by name, and so is
  a binary file or one too large to diff.
- **The owner's voice.** The body and every comment pass the owner's exact voice rules. `deeperReview` is not judged,
  because it is addressed to the owner.
- **The hunk is captured.** The card draws each comment under the lines GitHub itself would show: the hunk header,
  three patch lines above the comment, and the commented lines. The console may only run listed verbs, so the
  picture is stored with the row rather than re-read each poll.

## What `post` re-checks

- The row's recorded digest must still be the digest of its content. An edited register line is refused as drifted.
- **The head has not moved.** The digest binds the head commit, and a new push means the owner approved a review of code
  that no longer exists. Record it again.
- **The diff under each comment is what the card showed.** When the base branch moves, a hunk can change with no new
  commit on the pull request.
- **The door holds without `--approve <digest>`.** The digest covers the repository, the number, the head, the
  verdict, the body and each comment's anchor and words. It binds content; it does not authenticate the owner. No
  `$SLOPWEAVER_DOOR_OVERRIDE` waives it.
- The whole review goes in ONE `pulls.createReview` call, pinned to the approved commit, and is never retried. It is
  recorded `posted` the moment GitHub accepts it, before the readback, so a failed readback cannot leave a sent review
  postable twice. The readback then confirms the state GitHub holds and the commit it attached the review to.
- **One write at a time.** `record`, `drop` and `post` each hold the register's lock from their check to their append.
  So two posts of one row cannot both read it held and both send, and a `drop` cannot cross a `post`. The lock passes
  on only when its holder has died, never by age, because a post stalled on GitHub may still be sending. A post or drop
  also refuses while any register line is unreadable, because that line could be this row's `posted`. A reused id is
  refused at `record`, and ignored in the fold, so it can never bring a spent row back.
- **GitHub does not already have it.** Just before sending, post lists the pull request's reviews and refuses when
  this account already has one at the approved head with the same body. That covers a send whose answer was lost and a
  `posted` line that did not append, where the register still reads held. The refusal names the `drop` that records it.
