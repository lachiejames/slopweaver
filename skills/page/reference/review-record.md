# The review a page carries

The owner's word, said often: every briefing that reaches the owner gets at least one Codex review pass first,
because an inaccurate or incomplete briefing makes the owner steer off bad information. `page publish`
enforces it: a page with no `--review` is refused, and a cited review must have read the exact page being
published. The code is `src/pages/review*.ts` and `src/cli/commands/page/{reviewPrepareRun,publishReview}.ts`.

## The sequence

```bash
slopweaver page review-prepare <slug> --page <fragment>.html --inputs <owner-words>.md,<the-run-doc>.md
```

It builds `$SLOPWEAVER_HOME/page-reviews/<slug>/<preparation-id>/repo`, a git repository whose base commit
holds `inputs/` (numbered copies of each `--inputs` file) and whose head commit adds `page.html`, your fragment
with every reference publish would link already linked: the bytes the page will carry. It prints, each with that repository's `--repo` and the home's `--home`:

1. the `codex review --pass r1 --property-id … --property "…" --base <base> …` to run;
2. Codex capped, the `codex review-fallback prepare` and `record` pair, which a visible Claude session runs
   instead (rule 9); `record` needs the same `--repo` and `--home` as `prepare` to find its request;
3. the `page publish … --review <id>` that cites the result.

`--inputs` is what the page answers to: the owner's own words (the anchored turn, quoted), the run's doc, any
measurement it cites. A page reviewed against nothing proves nothing, so the flag is required.

## What to attack

One property per pass, and it must be falsifiable from `inputs/` and `page.html` alone. The printed default is a
starting point; narrow it to what this page most needs to get right. Useful properties:

- every claim on the page is supported by `inputs/`, with no number or date the inputs do not carry;
- the page answers the question the owner asked, and nothing they asked is missing;
- no total, count or quote on the page contradicts another part of the page or its source;
- the recommendation follows from the evidence shown, and its cost is stated beside it;
- nothing asks the owner to work something out personally (arithmetic, a riddle, a command they have to
  compose).

Run more passes for more properties and cite every one: `--review <id>,<id>`.

## What publish checks

For each id, a Codex pass record first, then a fallback receipt (by receipt or request id):

- the pass is a conclusive REVIEW (CLEAN or BROKEN), not a plan and not a no-verdict;
- its repository is one of this slug's preparations, by realpath under `page-reviews/<slug>/`;
- its base and head are the preparation's commits, its diff digest reproduces from them, and `page.html` at the
  head is the prepared fragment;
- then the fragment publish will write, links added, is compared with the reviewed one. `review-prepare` links
  the page the same way before committing it, so an unedited page matches; a reference the atlas only learned
  to resolve in between is an edit, and needs `--review-changed`.

One false citation refuses the whole publish, and so does one review cited twice (a receipt by both its receipt
and its request id), since the fold counts checks. A cited review that is false is a fact, not policy, so the hatch
never turns it into a waiver. An unreadable fallback store refuses rather than calling an id absent.

## BROKEN, or edited after the review

A BROKEN verdict, or a published fragment that differs from the reviewed cut, needs
`--review-changed "<what you changed and why>"`. When the bytes differ, the fold shows that sentence as what
changed and says plainly that the edits were not re-reviewed. When a BROKEN cut is published unchanged, it shows
the sentence as why the page was published as is, never as an edit. The better path after a real fix is a fresh `review-prepare`
and a new pass.

## The fold and the record

The page gets a `<details data-page-review="…">` fold after the fragment: each check as Held or Broken, who took
it, the pass, what it attacked and its summary, then what changed. Machine ids stay out of it;
`$SLOPWEAVER_HOME/page-reviews/<slug>/published.json` holds the ids, digests and instants. `briefing corrections`
strips the fold before diffing, so a new review never marks the page changed. A fragment that names
`data-page-review` itself, CSS escapes decoded, is a page-lint finding (`AUTHORED_REVIEW_FOLD`): an authored marker could forge a
reviewed fold, or a style selecting it could hide the real one. Arbitrary author CSS can still hide the last
element on a page; the authors are our own sessions, so that is residue, not a defence.

## The waiver

`SLOPWEAVER_ALLOW_UNREVIEWED_PAGE=1` publishes with no `--review`, for an archival republish or a diagnostic page
the owner will not steer by. The page's fold says "Not reviewed before you saw it", and the record says `waived`, so a
waived page is never mistaken for a reviewed one.
