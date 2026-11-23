# One check page for every reader, and the whole list past it

Bundled reference for the `github` skill, loaded when a `ci-green: unknown` or a `checksTruncated` row has to
be trusted or disputed. The test it feeds: [landing.md](landing.md).

**The check page is 100 — GitHub's own maximum — and a smaller one parks the whole fleet.** `ci-green`
answers `unknown` when a context the base REQUIRES was not on the page this read saw, which is right (a
capped rollup can only LOSE a failure) and which becomes the steady state the moment the page is smaller than
the heads it reads. MEASURED over the owner's open pull requests on one repository at a page of
60: about half came back truncated, nearly all of those read `ci-green: unknown` beside `ci: green`, and NOT
ONE row in the fleet read `press` — those heads carry more contexts than that page. One verdict even advised "re-read the checks with
a larger limit", addressed to the only caller that could take it. `CHECK_PAGE` in `live/github/reviewState.ts`
is the one number, asked for by the fleet read, the press-time re-read, `review-state`'s `--check-limit`
default and the session-start leg alike: a page per caller is the same defect one level up, and fixing the
landing read alone left `review-state` reporting 60 contexts for a head it saw far more of.

**A head past that page is re-read WHOLE, never parked.** A large monorepo's heads can carry more than 100
contexts, and green bumps the owner had standing-ordered merged read `ci-green: unknown` off a
page that never reached `Required CI`. Every truncated head is paged to 500 contexts
(`DECISION_CHECK_LIMIT`, `live/github/checksRead.ts`) on the same head before it is judged:

- **the fleet read** of `review-state` and `landing` (`cli/commands/github/reviewStateChecksCompletion.ts`),
  only the truncated heads, a few at a time;
- **the press-time re-read and `github enqueue`'s guard** (`live/github/wholeChecks.ts`), inside the one
  pull-request read itself, so the press judges every context rather than the first hundred.

A re-read that fails, finds the head moved, or is still cut short at 500 leaves the row as the first page read
it — honestly `unknown`, said on stderr, never a green.
