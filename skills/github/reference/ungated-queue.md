# The ungated queue, and why it is a refusal rather than a finding

A queue whose required-context set is EMPTY merges an entry on arrival without testing the merged result.
Every reason to reach for a queue is gone at that point, and so is "green main is not negotiable" — the
verb would be pressing a button that only looks like a gate. Acknowledging it could not make the queue
wait, which is this section's own test, so it sits here rather than among the findings below.

MEASURED on `lachiejames/slopweaver`, which is why this exists: the door ledger recorded
`verb:github.enqueue` one second before the pull request's merge commit was committed, against a CI lap this
repository measures at p50 9m23s (49 laps; the measurement and its doored reproducing command live on
`CHECKS_POLL_SCHEDULE_MS` in `src/live/github/checks.ts`). Two more pull requests landed the same way in the nine
minutes after it. The ruleset had the merge queue
required and "Require status checks to pass before merging" unchecked, and the second half is what did it.

**The contexts are read from BOTH governance mechanisms and unioned**, because a branch may be under either
and each is reported by a different API: classic branch protection appears only on GraphQL's
`Ref.branchProtectionRule.requiredStatusCheckContexts`, and a ruleset appears only in REST's
`GET /repos/{owner}/{repo}/rules/branches/{branch}`. Reading one alone is a defect that was actually
committed here first — the REST half went in on the unverified assumption that `main` is ruleset-governed,
and it is not. MEASURED: `GET /repos/lachiejames/slopweaver/rulesets?includes_parents=true`
returns only an Enterprise and an Organization ruleset, both `target=repository`, and no repository-level
branch ruleset at all, so `main` is CLASSIC. The REST-only read printed
`gated by:     NONE — the queue gates on nothing` against a queue genuinely gated on `build` and
`integration`, which would have false-refused every enqueue on this repository.

**A read that FAILS on either half refuses too** — it never defaults to "gated" and never falls back to the
half that answered, since an unmeasured gate that passes is the exact hole this closes. Every report opens
with a `gated by:` line naming the contexts, or `NONE — the queue gates on nothing`.
