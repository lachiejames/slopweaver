# Reading a pull request's state: `checks` and `review-state`

Bundled reference for the `github` skill. Loaded when a row has to be trusted, extended or disputed, not on every turn.

`github review-state` answers SEVEN questions about every open pull request a search selects, in one table:
is CI all green; is CodeRabbit all green; is it undrafted; which CODEOWNERS rules it still OWES a review; was it
mentioned in Slack at any point; has anybody been explicitly asked in Slack to review it; has that ask gone stale.
Read-only — no pull request, review request, comment or Slack message is written or changed.

```bash
github review-state --repo <owner/name> --author <login>          # the table
github review-state --repo a/b,c/d --json                                  # both repositories, machine-readable
github review-state --include-drafts --no-slack-live                       # fast, corpus-only, and blind past the watermark
github review-state --repo <owner/name> --number <n>                       # ONE pull request, granular (implies --detail)
github review-state --repo <owner/name> --author <login> --detail          # the table, then a block per pull request
```

**`--detail` answers what a HUMAN reads before deciding**, not a verdict: CodeRabbit approved yes/no; every
unresolved thread with who raised it, its first line and whether we answered it without resolving it; and each
non-passing check marked `REQUIRED`, `advisory` or `required unknown`. The rule also
**forbids gating a review ask on any of it** (a gate on the READ, never a licence to send one unasked — rule 10) — the whole reference is
[pr-state-detail.md](pr-state-detail.md).

**Reviewers are asked in Slack, never on GitHub; an ordinary GitHub review request is IGNORED**, the concept of
GitHub reviewer requests being set aside entirely. No row, verdict or
`--json` field here, in `github landing` or in session-start treats one as an ask, a chase or a blocker. The
one request field still read is GitHub's `asCodeOwner` flag, the APPROVAL requirement the merge queue
enforces ([github-codeowners.md](github-codeowners.md)). So the Slack legs are the whole answer: an exact
scan of the local Slack bronze, and a live `search.messages` over the window the corpus has not ingested
yet — ON by default, `--no-slack-live` turns it off.

**The property that makes this trustworthy is that it answers `unknown`.** An absence is only true over a
window, so where no leg can bound one the row says `unknown` and prints why, instead of reporting "nobody has
been asked".

**Only the CORPUS leg can carry a `no`.** Slack's own `search.messages` collapses proximate matches, so the
live leg contributes POSITIVE findings only, and a hit is an ANCHOR the run goes back and reads around. What
each leg may claim, the four bounds on the read-around, and the measurement behind all of it:
[slack-ask-evidence.md](slack-ask-evidence.md).

**A capped read is the same shape**, on a pull request with more review threads than one page: it can only
ever LOSE an unresolved CodeRabbit thread, so a would-be green becomes `unknown`.

**A `--repo` GitHub cannot resolve exits 1 naming it, never `0 of 0 open`**; landing lists it `unread` instead.

## An explicit review ask

A message merely containing the link, or the link plus the word review, is NOT an ask.
`src/review/askClassification.ts` certifies the constructions the owner actually writes, vetoes
the shapes that cannot be an ask whatever they say, and answers **`undecided`** for the rest — a confident
wrong answer on two pull requests is worse than an honest abstention on twenty. MEASURED over the 46 Slack
messages linking the owner's 22 open `acme-admin` pull requests: **45 of 46 exact, no false positive and no false
negative**; per pull request, over the 21 the corpus reaches, **17 asked, 2 never asked, 2 undecided**. An
`undecided` message makes `asked` read `unknown`, never `no`.

The seven-rung ladder, how recipients are scoped to a pull request rather than to a message, and why the two
Slack legs merge on `channel:ts`: **[review-ask.md](review-ask.md)**.

Three older rules stand unchanged:

- **A merge conflict outranks everything, including self-merging.** GitHub's `mergeable` is read on every
  row, and a `CONFLICTING` branch is `conflicting` in the ACTION column before any other answer is consulted
  — whoever reviews it, it has to be rebased first. `--json` carries `conflict.paths`, measured by
  `git merge-tree` against the base in a declared checkout (`src/checkouts/conflictPaths.ts`), and
  `conflict.why` says when they could not be measured, so an empty list never reads as "conflicting nowhere".
- **CodeRabbit is ADVISORY and never blocks an ask.** Gating on it once withheld four asks
  the owner had already decided to make. The verdict is reported; it cannot withhold one.
- **One landed human review closes an ask, whoever it came from.**

## One satisfied codeowner rule is not all of them

**The OWNERS cell says what is still OWED, not who was ever named.** MEASURED: three rows told the
owner to merge pull requests their codeowners had not approved, and GitHub refused all three. The row that was
confidently wrong named a real required approver — and the two team rules the same pull request invoked were
both still owed, so GitHub was showing _"Review required, 2 pending, merging blocked"_ beside a cell that read
as ready.

`reviewDecision` is not the fix: it came back **null on every pull request read live**, so a leg
trusting it learns nothing. The three rules the derived answer is computed from instead — the RULE is the
unit, a team rule is `unknown` rather than satisfied, and a reviewer's LATEST verdict is what stands — are in
[github-codeowners.md](github-codeowners.md) § How the derived answer is computed.

The cell reads `2/3 OWED: @org/data AND @org/infra`, `1/1 rules approved`, `1/1 unproven: @org/eng` or an em
dash when the changed paths invoke no rule at all. Whether the repository ENFORCES its CODEOWNERS is a
branch-protection setting this read does not fetch, and that is stated as residue rather than assumed.

**Owners are joined by their CONNECTIVE, never by a space** — `OR` inside one rule, `AND` across rules — because
that is the half that decides the owner's day: sometimes it is an and and sometimes it is
an or. The team answer, the `--detail` line and `codeowners.teams`: [codeowner-teams.md](codeowner-teams.md).

**Everything above is DERIVED from the file. GitHub's OWN answer sits beside it**, at `githubCodeowners` in
`--json` and on the `github codeowners:` line the `--detail` block prints ABOVE both derived lines, since it is the
authoritative source. It names WHO and states no
connective, because GitHub's API states none, so the two are complements rather than a replacement:
[github-codeowners.md](github-codeowners.md).

The same field is what lets **session-start say "merge"** instead of "act on the review": `PrReviewState`
carries each reviewer's verdict (`reviewedSinceAsk`) and the codeowner answer (`codeowners`), so a row can
distinguish an approval, requested changes, and an approval that still leaves rules owed.

**Reviewers are never derived from CODEOWNERS.** It is the wrong instrument for picking an individual —
teams are too broad. The verb reports the codeowner as a FACT and suggests a
reviewer from a different source: whom the owner actually tags per channel, learned from the owner's own corpus,
with the count shown so the owner can correct it. The owner's corrections are what refine the suggestion over time.

**A repository that lands its own work never produces an ask row** — `self-merges`, decided per pull request
from the CODEOWNERS the read already fetched: every rule names exactly one owner, and that owner is the
pull request's author (`isSoleAuthorRepository`). It is never "the checkout's own `origin`",
which made the answer depend on the working directory: run from a worktree of the team's shared repository,
all twenty of the owner's open pull requests there read `self-merges`. A repository with no CODEOWNERS is not
self-merging.

**A STACKED pull request is never an ask either, and its row says where it sits.** Session-start once
asked the owner to undraft the sixth pull request of a native stack and name a reviewer
for it; the owner is not asked about a stacked pull request until it targets staging. The test is the base branch alone, against
the repository's default branch the fleet read carries beside each pull request: a base that is not the
default branch makes the recommendation `stacked` (the cell reads `stacked, no ask`), checked BEFORE the
draft test because that pull request was a draft too and `still-draft` would have said "undraft it and ask"
— the exact sentence the owner objected to. `self-merges` still outranks it, since that means nobody is ever
asked. The chain is read off the fleet's own `baseRefName`/`headRefName` links
(`src/review/stack.ts`), never from GitHub's stack endpoints, and `--json` carries each pull request's
`stack` — its position, the whole chain bottom-up, and whether the chain was followed all the way down to
the default branch. The bottom pull request of a stack carries the stack's only ask; session-start's row
for it names every pull request queued behind it, and the stacked rows themselves are suppressed from the owner's
list with the reason stating which pull request they wait on.

`--limit` caps how many pull requests are read (GitHub's own search ceiling is 1,000); `--check-limit` and
`--file-limit` cap the per-pull-request check contexts and changed paths, and a pull request with more files
than the cap says so rather than reporting a partial CODEOWNERS answer as complete. `--check-limit` defaults
to `CHECK_PAGE`, the one page every read of this shape asks for ([landing.md](landing.md)) — a smaller one
here reported 60 contexts for heads carrying 94 while the landing read saw all of them. A head past that page
is re-read whole before it is judged (`reviewStateChecksCompletion.ts`), and only one still cut short at 500
stays truncated.

**A page GitHub will not answer is HALVED, under a 90-second budget.** A declined page (`search: null`, a 502 at
~11s) halves down to one pull request and KEEPS the reduced size; a page of ONE that still fails ends the read
with GitHub's own message, a RATE LIMIT at once. Halving IS the page's retry, so it turns off both Octokit
retry budgets and aborts at 30s or the budget's remainder. Past 90s the read ends BY NAME and returns nothing —
a partial fleet would print a false "raise --limit"; `session-start` names it in `could not see` and still
refreshes the owner's list inside the tick close's 420s. Trade: a transient failure at size ONE gets one attempt, not
four. Measured: `src/cli/commands/github/reviewStateFleet.ts`.

## What `github checks` merges, and what the raw-tool guard blocks in its place

It reads GitHub's own aggregate `statusCheckRollup` (the same live GraphQL field `read` already fetches),
merging GitHub Actions Check Runs and legacy commit Statuses into one picture — the same two systems `gh pr
checks` itself merges. It is a pure read: no token write, no door record.

**`--until` adds the review and comment legs.** One event line per change and nothing while nothing happens:
`HEAD <sha> pushed` on a new head, `CI PASS|FAIL … on <sha>` once per head, `REVIEW <login> <STATE> on <sha>
at <ts>` for a review of the CURRENT head after `--since`, `COMMENT <login> at <ts>: <excerpt>` for a human's
comment after it, `MERGED <ts>`/`CLOSED`, then `WATCH-DONE ci-green|ci-failed|review|comment` or
`WATCH-TIMEOUT` — or `WATCH-FAILED`, below. `ci` ends on the verdict, `review` on the first new review, `any` on the first of those or a
comment, `merge` only when the pull request lands or closes. Measured against the script it replaces:
the private work repository's ship skills armed a checked-in shell watcher — one GraphQL read every 20 seconds
over the head, the last 30 reviews and the last 100 comments — because an audit there found 223 timer-driven
wakes at ~590k tokens of context each learning nothing, against CodeRabbit landing 1–4 minutes after a push.
That script reaches GitHub outside the door and is refused at it by the raw-tool guard, so the
verb carries the same three signals (`src/live/github/prEvents.ts`): a review counts only on the CURRENT
head, so a stale pre-push verdict cannot re-fire; nothing the viewer wrote is an event, and neither is a
`[bot]` comment, because a session posting nudges on the pull request it watches is otherwise a wake loop
(measured: seven self-wakes on one pull request); the first poll is a silent baseline; and the cursor is an
ISO `Z` instant compared as a string, refused in any other spelling. What the script judged that this verb
does not: it read `mergeStateStatus` to separate an unprotected base from an unformed gate. A red check is a
`CI FAIL` here whether or not branch protection requires it, and a caller that needs the required-only
verdict reads `review-state`.

**A failed read never ends a watch silently.** A read GitHub refuses on its rate limit names its own end, so
the watch prints `RATE-LIMITED until <reset>, waiting <n>s` and reads again after it (`--wait` says the same on
stderr, keeping stdout for status lines); a reset past `--timeout-seconds`, or any other failed read, prints
`WATCH-FAILED <why>` and exits 1. Measured: two `--until merge` watches died on `API rate limit
already exceeded` with the message on stderr only and no reset, and the seats' `2>&1 | grep -v …` reported
grep's exit 0 — a death read as a finish. A pipe's status is its LAST command's: read the terminal line
(`src/cli/commands/github/checksRateWait.ts`, `src/live/github/rateLimit.ts`).

**What the verb DOES read, because the rollup cannot supply it: the base branch's required contexts.** Once
per run — the set is a property of the branch, not the head — with both governance mechanisms unioned exactly
as `github enqueue` reads them (classic protection over GraphQL's `Ref.branchProtectionRule`, a ruleset over
REST's rules-for-a-branch). Every status line carries the verdict, `2/2 required present` or `2 REQUIRED CONTEXTS
NEVER RAN: build, integration` (`NOT YET CREATED` mid-lap, [required-contexts.md](required-contexts.md)), and
anything short of satisfied exits `EXIT_EXPECTED_EMPTY` with a refusal, never `EXIT_OK`. A read that FAILS
answers `required contexts UNREAD (<reason>)` and refuses nothing: it never defaults to satisfied, and never
turns a permission problem into a merge refusal. Why it exists: `statusCheckRollup` summarises the runs PRESENT
on a head, so a required context that never registered is not `FAILURE` in it — it is absent, and the rollup
reads `SUCCESS` over whatever else ran. Mirror of the superseded-run case above: that one is a stale RED the
rollup pins, this a false GREEN nothing else refuses. The refusal **names the cause** from `mergeable`, since
the remedies are OPPOSITE: `CONFLICTING` creates no `pull_request` run at all and needs a rebase onto the
base's CURRENT tip, `MERGEABLE` makes a rebase wrong, an unselected one establishes NOTHING.

**Absence only counts when the read saw the WHOLE head**, since `contexts(first: $limit)` returns a page. A
truncated read says `UNPROVEN` not `NEVER RAN`, names NO cause, and asks for a wider `--limit`; it is still not
`EXIT_OK`. `--limit` defaults to 100, the connection maximum. MEASURED on one acme-admin pull request: 93
contexts against a default of 50 called `Required CI` never-run when it had PASSED.

The raw-tool guard (`src/admit/rawTools.ts`) enforces this mechanically, not just by prose: `gh pr checks
--watch`, an `until`/`while` loop hand-polling `gh pr checks`, and `gh run watch`/`gh run view --watch` all
fail loudly under `SLOPWEAVER_ALLOW_RAW=1`. `gh pr checks -w` is `--web`, not a watch, so it and a one-shot
`gh pr checks <n>` stay unblocked. `gh run watch`/`gh run view --watch` are run-id-keyed and this verb has no
`--run`, so their block says no governed verb covers them yet. A one-shot `gh run view --log*` or `gh api`
run/job/log fetch is blocked too, pointed at `checks --log` and `github run-log` ([job logs](job-logs.md)).
