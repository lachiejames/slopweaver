# CodeRabbit threads: judge each one, then fix it here or answer it and resolve it

Bundled reference for the `github` skill. Load it before touching a CodeRabbit thread on a repository
CodeRabbit reviews (`acme/acme-admin`), whether a `coderabbit-loop` dispatch sent you or you found one on
your own pull request. CodeRabbit is disabled on THIS repository, so nothing below applies to a slopweaver pull request.

## How it is disabled here, and what holds that

The committed `.coderabbit.yaml` sets `auto_review.enabled: false`, no summary or title writes, no status
check, no chat replies, and `inheritance: false` so the org-level config cannot re-enable it. A renamed key
would silently re-enable reviews, so `src/coderabbit/schemaCheck.ts` validates every key in that file against
CodeRabbit's own published schema and fails CI instead. A `review` badge on a slopweaver pull request, or a
reviewer step in general, therefore never has CodeRabbit as its source; the human maintainer is the only
reviewer ([pull-requests.md](pull-requests.md)).

## The standing rule

If CodeRabbit raises a comment on a pull request and it is worth fixing, fix it; otherwise resolve it, and the
owner never has to give a steer on CodeRabbit. **A CodeRabbit
thread is never carded to the owner.** It is judgement, the same judgement a human reviewer applies, and under
[rule 10](../../../AGENTS.md) clearing it is the fleet's own act, recorded with `slopweaver autonomy record`.

## The judgement, in the order a human makes it

1. **Is it a real issue?** Read the whole finding, not the excerpt, and check it against the code. CodeRabbit is
   often wrong about intent and sometimes wrong about fact.
2. **Do I agree?** A comment that would CONTRADICT the fix this pull request makes is pushed back on, with the
   reason, and resolved.
3. **Does the fix belong in THIS pull request?** If this pull request introduced the problem, fix it now. The reason: land with it open and the owner and the fleet will later look at it again and find some are
   worth fixing, turning one pass into a long dragged-out one. A problem that was already there usually does not
   belong here, but sometimes it does: a one-line fix in a file you already touch can.
4. **Is it worth the cost?** Something inconsequential, such as US to UK English, is not worth a
   stack reshuffle. Answer it and resolve it.

Worth fixing means fix, push, then resolve the thread with a reply naming the commit. Everything else is
`reply --resolve` with the reasoning. **Never resolve in silence**: a bare resolve reads as a dismissal.

**A PERSON on a CodeRabbit thread is not CodeRabbit.** A colleague who replied there is the owner's to read, and
`github landing` escalates that shape to `needs-owner-judgment` ([dispatch.md](dispatch.md)); do not answer
them as if they were the bot.

## The procedure

```bash
slopweaver github review-state --repo acme/acme-admin --number <n> --detail
slopweaver github thread list --repo acme/acme-admin --number <n> --open --full
slopweaver github thread reply --repo acme/acme-admin --number <n> --thread PRRT_x --body - --resolve --dry-run
```

- **`--detail`** prints `CodeRabbit approved`, then `changes requested by:` (CodeRabbit and every human whose
  latest opinion still asks for changes), then each open thread with its disposition — `AWAITING US`,
  `we answered, still open`, `REVIEWER REPLIED, still open` — and the finding's title
  ([pr-state-detail.md](pr-state-detail.md)).
- **`thread list --open --full`** prints every unresolved thread's whole opening comment. Judge from that.
- **`reply --resolve`** is one operation, reply first ([pr-operations.md](pr-operations.md#review-threads)).

## The flip

CodeRabbit does not resolve its own threads. Once EVERY CodeRabbit conversation is resolved, whether fixed or
answered, a check runs and its review flips from changes-requested to approve; which takes about
ten seconds. Three things follow, each printed by `--detail`:

- **An OUTDATED unresolved thread still holds the verdict.** A push that moves the code does not release it:
  `CodeRabbit's CHANGES_REQUESTED is held by N unresolved outdated CodeRabbit comment(s)`. Judge and resolve
  those too. MEASURED: such a pull request once read only "latest verdict is CHANGES_REQUESTED".
- **Every thread resolved and the verdict still standing is `stuck`, and the fleet re-requests the review
  itself.** Once all the comments are resolved and a good twenty seconds have passed without the review switching
  from requested changes to approval, it is probably stuck, and forcing that re-review is the desired behaviour under
  graduated autonomy. `github landing --press` does it, no card: twenty seconds
  after the read that saw every thread resolved it re-reads, and if still stuck posts `@coderabbitai review`,
  once per head, with an autonomy row ([coderabbit-nudge.md](coderabbit-nudge.md)). Still
  standing after THAT, read CodeRabbit's latest review BODY with `github read <pull-request-url> --json`: it
  puts comments outside the diff range there, which no thread carries and no resolve clears, so each wants
  the same judgement.
- **A new push starts a new review.** `stale` means CodeRabbit last reviewed an earlier head, or that its
  approval names one while only a comment stands on this head; its next pass may open new threads, and
  they get the same judgement.

`review-state` still never gates a Slack review ask on CodeRabbit ([review-state.md](review-state.md)).

## Whether it earns its noise

`github coderabbit-yield` counts, over a window of one author's pull requests, how many findings carry
evidence they were acted on and how many were resolved without any: [coderabbit-yield.md](coderabbit-yield.md).
