# The code owners GitHub itself computes, read rather than reverse-engineered

The authoritative half of the codeowner answer. The code is `src/review/githubCodeowners.ts`; it is carried
on `slopweaver github read <pr url>` as raw GitHub fields, and on `slopweaver github review-state` as
`githubCodeowners` in `--json` and the `github codeowners:` line in the `--detail` block.

**Why it exists.** Programmatically determining who the code owners are on a pull request is hard when the answer
comes from reading the CODEOWNERS file and reverse engineering it. Reading it from the authoritative source is the
fix, and if the data was not already carried, it was being thrown away for no good reason.

The measurement, not a preference, is the reason. Before this verb carried it:

```bash
grep -c reviewRequests src/live/github/read.ts        # 0 — `github read` carried NO codeowner information
grep -c asCodeOwner src/live/github/reviewState.ts    # 0 — review-state dropped GitHub's own flag
wc -l src/review/codeowners.ts src/review/codeownerRules.ts src/review/codeownerTeams.ts   # 801
```

Those 801 lines re-implement GitHub's glob matcher against a fetched CODEOWNERS blob. They stay, and this is
not a replacement for them — see § Why both, below.

## The two fields, and what each one is

GitHub gives the answer in two places, because a code-owner requirement is visible differently before and
after it clears:

- **`reviewRequests[].asCodeOwner`** — GitHub's own boolean on an OPEN review request. `true` means GitHub
  itself required this reviewer as a code owner. These come back `pending`.
- **`reviews[].onBehalfOf`** — the teams a submitted review was recorded as satisfying. GitHub retires the
  `asCodeOwner` request the moment the requirement clears and records the team here instead; this is what
  its interface renders as the satisfied owner. An `APPROVED` review's teams come back `approved`.

An open request WINS over an earlier approval on the same team: GitHub reissuing a request is GitHub saying
it is waiting again.

Teams are named by `combinedSlug` (`owner/team`), which is the token CODEOWNERS itself spells, `@`-prefixed
so it can be pasted straight back into GitHub. Teams sort before individuals, alphabetical within each.

## What GitHub's flags CANNOT tell you

Stated on every answer as residue rather than discovered later: **a satisfied INDIVIDUAL owner is invisible.**
The request is gone and there is no `onBehalfOf` equivalent for a person, so their cleared requirement is
indistinguishable from any other approval. A satisfied TEAM is recoverable; a satisfied person is not.

Two more residue lines fire when the read was capped — more review requests than the page carried (a pending
owner may be missing) or more reviews than it carried (an approved team may be missing).

## Why both answers, kept apart

They answer different questions and only one of them is GitHub's:

| Question                                      | Answered by                                 |
| --------------------------------------------- | ------------------------------------------- |
| WHO are the code owners on this pull request? | **This.** GitHub's own flags.               |
| Which CODEOWNERS _rules_ does it still owe?   | `codeownerRules.ts`, derived from the file. |
| Is it an AND or an OR?                        | `codeownerTeams.ts`, derived from the file. |

**MEASURED on the owner's 29 open `acme/acme-admin` pull requests**: the
derived answer called 21 unsatisfied, 8 unknown and **0 satisfied**, because nearly every rule there is a
team rule and `codeownerRules.ts` calls a team rule `unknown` rather than satisfied by design. A landing
selector built on it would queue nothing on that repository, ever — which is why `codeowners-satisfied`
reads GitHub's own flags ([landing.md](landing.md)).

**An open `asCodeOwner` request means GitHub ASKED somebody, never that the base REQUIRES them.** These flags
answer who was asked; only `mergeStateStatus` answers whether that ask is still holding the merge, and the
landing test asks both ([landing.md](landing.md) § A pending REQUEST is not a REQUIREMENT).

### How the derived answer is computed

It reads GitHub's own two inputs — the CODEOWNERS rules themselves, and the reviews that have landed —
because `reviewDecision` came back **null on every pull request read live**, so a leg trusting
it learns nothing.

- **The unit is the RULE, never the flattened owner token.** GitHub requires one approval per matching rule,
  from any one of that rule's owners. `/apps @a @b` is satisfied by `@a` alone; `/apps @a` plus `/infra @b`
  needs both, and a flattened list reports `@a @b` either way.
- **A user rule is decidable, a team rule usually is not.** Team membership is in nothing that read fetches.
  So a team GitHub still has a review request out to is `unsatisfied` and said out loud; a team with no
  outstanding request is `unknown`, **never `satisfied`** — nothing there reads ready from an absence,
  because asserting ready is the error that costs the owner a refused merge.
- **Each reviewer's LATEST verdict is what stands.** Approve on Monday, request changes on Thursday, and the
  Monday tick is not an approval.

GitHub's API states no connective, so this answer **claims none** rather than inventing one — which is
exactly why the derived pair is not deleted. Merging them would mean asserting a connective that GitHub
never gave.

## The proof

Verified against live pull requests through the shipped verbs. `github read` on one of them
returned `asCodeOwner: true` beside a `combinedSlug` team on the review request, with `reviewDecision` null —
so the flag is available exactly where the previous query was not looking, and `reviewDecision` is not a
comparator (the same null it reports elsewhere).
