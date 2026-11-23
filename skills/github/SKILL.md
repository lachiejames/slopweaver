---
name: github
description: Read current GitHub objects, answer which open pull requests still need a reviewer asked in Slack or can land now, break each into ONE next act, suggest a reviewer, park a review of a colleague's pull request as draft line comments for the owner's yes, watch and TIME a PR's CI checks, push a branch, attach an inline image or video, govern PR state and descriptions, retarget a PR's base, request review from a colleague or team, label an issue or PR, list or dismiss a code-scanning alert, tag a commit or delete a remote branch, manage a native GitHub stack, hold and release the merge queue, press GitHub's own 'Merge when ready', run CI locally and land on it when Actions is off, and run the pre-merge guard. Use when the user asks to read a GitHub issue, pull request or discussion; review or thank a colleague on their pull request; ask which open PRs need a review ask, are blocked, have a stale one, or can land; watch, re-run or time a PR's CI jobs; push a branch; open, update, ready or close a pull request; fix its description; post, edit, reply to or resolve a comment; list/dismiss a CodeQL alert, or turn CodeQL on/off; read a repository's Dependabot alerts; set a repository's description, or create, rename, transfer, archive or publish it, or turn its Actions on; plan a history re-cut; put a screenshot or video in a PR; manage a stacked pull request; stop other sessions merging while one lands; queue one for GitHub to merge when ready; turn hosted Actions off, or run CI locally; or check whether it can merge.
argument-hint: read|search|review-state|review-draft record|review-draft post|landing|press-reseal|reviewer list|reviewer pick|reviewer read|bottleneck|coderabbit-yield|checks|ci-runs|ci-timing|rerun|cycle|watchers|turn-path|push|ready|close|label|comment create|comment edit|thread list|thread reply|thread resolve|thread reopen|alert list|alert dismiss|code-scanning show|code-scanning enable|code-scanning disable|actions|exposure inventory|exposure sweep|push-root record|push-root list|repoint-plan|vuln list|vuln get|vuln body|repo|tag create|branch delete|attach upload|attach status --org|pr update|pr request-review|pr retarget|pr release-reservation|pr summary|pr standing|pr reviewers|stack push|stack restack|stack submit|stack sync|stack adopt|stack remove|stack dissolve|hold|release|merge|enqueue|lap|lap-seat [...]
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" github $ARGUMENTS` and report the result.
Everything below is judgement the CLI cannot express. Read it before your first invocation.

## Watch a pull request's CI checks

Use `github checks --number <n>`, never a hand-rolled `gh pr checks`/`gh run watch` loop: every poll of a raw loop lands
its full output in your own transcript, at an interval nobody tuned to this repository's real CI.

```bash
github checks --number 370 --wait --json   # poll until every check is terminal
github checks --number 370 --log           # what the FAILED checks actually printed
```

One read reports the current state and exits; `--wait` polls with a stepped backoff (10s → 60s ceiling, tuned to this repository's measured CI run) until every check is terminal or `--timeout-seconds` (default 1200) expires, one compact line per poll, never the raw payload. The exit code is itself a signal: `EXIT_OK` only once every check is terminal, none failed AND every context the BASE requires actually ran — the rollup counts only runs PRESENT, so a missing one reads green; `EXIT_EXPECTED_EMPTY` is every other legitimate state, so `--wait && echo merge-ready` composes cleanly. `--until ci|review|any|merge [--since <iso-Z>]` adds reviews and comments as event lines, the watch a parked `Monitor` arms. That contract, the required-context read, the blocked raw `gh` shapes and `github turn-path --head <ref>` are in [reading PR state](reference/review-state.md). `github required-contexts` is the WRITE half — the one door onto which contexts a branch requires, ADDING by default so nothing already required is dropped, and refusing a name no merge-group entry has run because a queue stalls on a required check that never arrives ([required contexts](reference/required-contexts.md)). `github push-restriction` is the door onto WHO may push, merge or enqueue onto a branch — `main` is restricted to the owner, never protected by a required review, because an admin bypass is never honoured by the queue ([push restriction](reference/push-restriction.md)). `checks` reports STATE and never DURATION, so `github ci-runs` times every job over a window of runs and `github ci-timing` reports ONE run's job times and never reddens on them (two spellings are not guessable: [CI timings](reference/ci-timings.md)), and `github watchers` says which sessions hold a watch on each pull request ([checks-read](reference/checks-read.md)).

**A red leg is READ, never reproduced**: `--log` prints every `##[error]` annotation in full and then the tail of the failing step, and `github run-log <run-id> [--job <name>]` is the same read reached from a run id — the only way to see a job that PASSED. Never run the lane in this seat to learn what CI already said; annotations LEAD the report because on the measured run they sat 860 lines above the step's end, and `--lines <0..2000>` is a real ceiling rather than a display option — [job logs](reference/job-logs.md). A leg the log shows red on a TRANSIENT provider error is re-run with `github rerun --repo <owner/name> --run-id <id>` (or `--number <n>`, every failed run on the head), which re-runs the failed jobs through the door and reads back the next attempt; never raw `gh run rerun`. A re-run reuses the merge commit its run first checked out, so when the BASE has moved, `github cycle --repo <owner/name> --number <n>` closes and reopens the pull request instead — only once `refs/pull/N/merge` sits on the base's live tip: exit 4 while GitHub computes, and a merge GitHub SETTLED onto the old base needs `--prime` first ([job logs](reference/job-logs.md)).

## Read one current object

Use `github read <github-object-url> --json` for one issue, pull request or discussion — it also pulls one unambiguous
URL out of a question passed by `route plan`. One typed GraphQL read: the provider bytes with `readAtIso`,
selected-field coverage and every connection with another page; each activity connection defaults to 25 items, `--limit`
raises that to at most 100, and a reported continuation is residue to widen deliberately, never proof the first page was
complete. It is a named-object reader: with no link, find candidates by `github search` — a relevance-ordered SAMPLE
unless `coverage.kind` is `complete`; a SET passes `--complete` — [search.md](reference/search.md). `--media-out <dir>`
saves the body's images and videos ([attachments.md](reference/attachments.md#downloading-body-media)); `--files`, a PR's patches and, un-merged, `data.diffOnBase` — whether the diff is already on its base's current tip, the one receipt for "already in". `--files` pages to GitHub's 3000-file cap, the residue naming any cut, so what a PR touches is checked there, never off its body; a claim about the CODE is `git show <head-sha>:<path>` when the head is local — a "PR bodies, not diffs" caveat protects the reader, not the reasoning.

## Which open pull requests still need a reviewer asked in Slack

**Review asks happen in Slack only; a GitHub review request is never an ask, a chase, a blocker or a next act** — only its `asCodeOwner` approval requirement is read. `github review-state --repo <owner/name> [--author <login>] [--json]` answers seven questions per open pull request: CI, CodeRabbit, draft, the codeowner-required approver, and whether Slack was told, asked or needs a bump; it and `github read` carry GitHub's OWN code owners, never a reading of the CODEOWNERS file ([github-codeowners.md](reference/github-codeowners.md)). It answers `unknown` rather than `no` where no window can bound an absence — read the [reading-PR-state reference](reference/review-state.md) before trusting or extending a row.
**`github landing`** asks the LANDING question over the same read — six tests, ONE act per pull request (`press`, `spawn-ci`, `spawn-coderabbit`, `answer-threads`, `blocked-on <who>`), `--press` to queue every ready one of the owner's and every ready bump in one pass (anybody else's capped at three per repository), and a register naming every press: [landing.md](reference/landing.md); a carried register refusing with "a key its own fields do not hash to" is re-keyed by **`github press-reseal`**, preview then `--apply`. It prints ONE fact line per pull request naming its blocker — the failing check, CodeRabbit, approvers, code owners — with `--full` for the table and `--pr <n>` for one row whole, its failing test files and whether it added them: [landing-output.md](reference/landing-output.md). The supervisor runs it at boot outright and on EVERY tick as `--if-due --press --register --record-reading tick-<n>`, where a cadence register — not a rule anybody remembers — decides whether this tick reads at all, and a read that happens is appended to the [readings ledger](../reading/SKILL.md) so the console shows the tick's own bytes, and every ask it saw to the reviewer register that **`github reviewer list|pick`** reads to say who each pull request is on the hook with and suggest a reviewer, a pick sending nothing; a message the landing could not settle ("not known who was asked") is read by a visible session and written back with **`github reviewer read`**, quote-checked, which the next landing honours: [reviewers.md](reference/reviewers.md). The BACKLOG question is two further verbs off the same read: **`github bottleneck`** groups every open pull request by ONE cause down a fixed ladder, drafts IN, and **`github bump-drive`** drives the dependency bumps — including the two acts no other verb can express: the `undraft-and-enqueue` every renovate bump here needs, and the `rewrite-body` that recomposes a bot's description, since the origin rule means renovate's own template can NEVER pass `dev-gate` — on a four-hourly recipe row: [backlog.md](reference/backlog.md). **`github coderabbit-yield --repo <owner/name,...>`** measures whether CodeRabbit earns its noise: every finding on one author's pull requests over a window, classified by the evidence it was acted on — [coderabbit-yield.md](reference/coderabbit-yield.md).
Most rows also carry a **DISPATCH verdict** the supervisor acts on (a row with none says whether it is `waiting`, `outside-the-set` or `unread`) — one of `rebase-and-fix`, `merge-now`, `resolve-then-merge`, `resolve-then-bump`, `coderabbit-loop`, `needs-owner-judgment`, `draft-first-review-ask`, `finish-or-card-close` — with the conversation counted for CodeRabbit and humans apart, how far the head is behind its base, and whether a chase is due. Every verdict but `needs-owner-judgment` is spawned and that one alone is carded; a `resolve-then-bump` chase and a `draft-first-review-ask` first ask (or its discussion opener, where no discussion agreed the change and it is no obvious bug) are PARKED as drafts for the owner's yes (`slack draft record`), never sent, and a draft is finished or its close carded, never closed; and a TERMINAL verdict is refused while any evidence it would be CLAIMING is unread: [dispatch.md](reference/dispatch.md).

## Put a screenshot or a video in a pull request

`raw.githubusercontent.com` does not work for this — on a PRIVATE repository it renders as a broken image for every
other viewer, measured the hard way on five real pull requests — and GitHub strips a `<video>` tag out of a body
entirely. The one form that renders inline everywhere, public or private, for every viewer is a
`https://github.com/user-attachments/assets/<uuid>` URL, and `github attach` is how you mint one.

**`attach upload` is CLOSED until the owner's recorded `handover rule … --attach-upload permitted`**, no hatch; closed, the picture stays local and the proof says so ([why](reference/attachments.md#attach-upload-is-closed-until-the-owners-ruling-permits-it)). **An expired session is NEVER a reason to ship less** — never a link for the image. **A
recording is an `.mp4`, never a GIF**: a GIF loops with no scrubber or duration, so `attach upload` refuses any GIF and any
file no capture verb wrote (`browser shot|terminal-shot|console-shot|redact`, or `slopweaver proof cassette --tape <t> --out <x>.mp4`), and takes a one-line `--proves`, scanning it and the frame text, then reads the upload back before its `upl-<uuid>` receipt. **Proof lives in the description as a user attachment** — never a release, a PR comment or a
committed proof folder, and every write door refuses each. **Read
[reference/attachments.md](reference/attachments.md) before the first `attach` call**: the session source, the separate
org-SSO grant, the size ceilings and the refusals are there.

## Move a pull request's state

Each takes `--dry-run` first, then the same command without it. The
[operations reference](reference/pr-operations.md) carries what each outcome means and why each refuses.

- `github ready --repo <owner/name> --number <n>` — [draft to review](reference/pr-operations.md#mark-a-draft-ready-or-close-it). `github close --repo <owner/name> --number <n> [--why "…"] [--expect-head <sha>]` — [closes an open pull request through the door](reference/pr-operations.md#mark-a-draft-ready-or-close-it), refusing a merged or already-closed one by name and refusing a silent close unless a recent comment or `--why` explains it.
- `github label --repo <owner/name> --number <n> --add <a,b>` — add-only, and it [refuses a label the repository does not define](reference/pr-operations.md#labels).
- `github pr request-review --repo <owner/name> --number <n> --reviewer <login,...>` — [request review from one or more colleagues and/or teams](reference/pr-operations.md#requesting-review); each `--reviewer` login is [resolved against the derived identity directory](reference/pr-operations.md#requesting-review) first — a login the roster does not confirm is refused rather than guessed; a branch whose board row is a fleet FINDING the owner has not ruled on is refused too (`finding-unruled`), as `stack push` is — see [pull-requests.md](reference/pull-requests.md). `github pr reviewers <url> [--pick @team=@person]...` — derive [who reviews what](reference/reviewer-table.md) from the diff and the base branch's CODEOWNERS, printed and never written (a C3 description has no reviewer table).
- `github comment create|edit --repo <owner/name> --number <n>|--comment-id <n> --form <json|->` — [post or edit a plain top-level comment](reference/pr-operations.md#top-level-comments), posted under the operator's own login (attributable, not authenticated).
- `github thread list|reply|resolve [--open --full]` — [answer a reviewer instead of dismissing them](reference/pr-operations.md#review-threads), and a CodeRabbit thread is JUDGED, fixed here or answered and resolved, never carded to the owner: [coderabbit.md](reference/coderabbit.md); `github alert list|dismiss` — [list or dismiss a code-scanning alert](reference/pr-operations.md#code-scanning-alerts) rather than a human's own click; `github code-scanning show|enable|disable` — [read CodeQL default setup, or switch it on (previewed, sent on `--approve <digest>`) or off](reference/code-scanning.md), refused and named when the org controls it; `github vuln list|get|body` — the OTHER alert family, Dependabot's (CVSS, and the `/security/dependabot/<n>` citation path), whose ladder and reviewer bar are the `vulnerability-fix` skill's.

## Describe, create, rename, transfer, archive or publish a repository; turn Actions on; tag a commit; delete a branch

`github repo --repo <owner/name> --description <text> --dry-run`, then without `--dry-run`, sets the description
(`""` clears it); `set` means the read-back matched. `--rename-to <name>`, `--transfer-to <owner>`, `--archive`,
`--create [--public]` (private by default), `--set-public`, `--apply-manifest <path>` and `--enable-actions` each
PREVIEW by default and send only with `--approve <ghrepo-digest>` from that preview, confirmed by a read-back — never a
browser or `gh repo create`: [repository.md](reference/repository.md). Before a private repository goes public, `github exposure inventory --repo <owner/name>` counts every surface the switch publishes, read-only and counts only, and names each surface it could not count; `github exposure sweep` scans that text, findings to the state home only: [exposure.md](reference/exposure.md). Before a history re-cut, `github push-root record` binds the repository to its fresh root so every push of an old-history commit is refused, and `github repoint-plan` dry-runs every local place the switch repoints: [repository-recut.md](reference/repository-recut.md).
`github tag create` and `github branch delete --keep-as-tag <t> --expect-tip <sha>` are the ref verbs, dry-run first, never a UI click or `git push --delete`:
[refs.md](reference/refs.md) — the refusals, and the one atomic compare-and-swap the delete is sent as.

## Open a pull request — `stack push`, always. Push an existing one — `push`

`github pr create` is REFUSED and names `stack push` instead: every pull request Slopweaver opens is a native GitHub
stack entry, and a `target.base` of the repository default is the bottom of a stack of one.
It amends the worktree AS RUN (a mid-push edit, or an untracked path nobody staged, refuses) into the commit and pushes it, so no `github push` first. Same form and same
gates, `--file`/`--form-example` included — [stacks.md](reference/stacks.md).

A create that failed without a response still holds the branch locus, and the NEXT `stack push` settles that itself
against the branch PAIR — releasing it when GitHub has nothing there, adopting the number when the create really
landed. Where that read fails or the pair is ambiguous, `github pr release-reservation --repo <owner/name> --base <b>
--head <h>` is the operator's door, so the recovery is never `rm` on a trust ledger — [pr-forms.md](reference/pr-forms.md).

```bash
github stack push --form - --dry-run   # then again without --dry-run
github push --dry-run                  # a branch whose pull request already exists
```

After a rebase, add `--force-with-lease` to both `push` invocations — an exact lease against the target SHA the verb read
immediately before the door, not a blind force push and not the ambient tracking ref. It cannot express an arbitrary
refspec, pushes only the checked-out branch to the same-named remote branch, refuses the remote default branch and a
dirty tree, runs the pre-push hook BEFORE opening the transport (refusing lefthook's no-runner exit 0), and verifies the remote SHA afterwards. **Neither verb
can push one entry in the middle of a stack alone**: a push of a branch with open pull
requests stacked on it rebases and pushes every one of them in the same invocation, or refuses and names each one it
would orphan (`--orphan-above <n,n>` is the exact-set break-glass) — [stacks.md](reference/stacks.md).

**After any squash onto a base that moved while you worked, diff against the base and confirm every listed file is one
you meant to touch.** `github push` prints a `WARNING` naming each silently-restored file and `github merge` is the real
gate, raising a blocking `reverts-main` finding — why a green CI cannot catch this, and the `docs-budget` finding the
same report raises, are in [reference/pull-requests.md](reference/pull-requests.md).

## Merge your own pull request

```bash
github merge --repo <owner/name> --base origin/main --head <branch> --description - < body.md   # report only
github merge --repo <owner/name> --base origin/main --head <branch> --description - --admin --number <n> [--dry-run]
```

**It FETCHES the base tip and opens by naming the tree, base and head it measured**; an unfetchable tip
degrades to the local ref with an acknowledgeable `base-unresolved` finding, never a silent wrong answer.
Without `--admin` this is a report: no token, no GitHub call, nothing merged. **With `--admin`, a clean
report is followed by a real squash merge** through the administrator's branch-protection bypass, recorded
by the door — an explicit option and never a default. `--dry-run` makes every check and writes nothing.

**`--admin` REFUSES a base that requires a review and is NEVER offered as a route past one** — nor by a card, row or
page, which the form schema and `briefing check` refuse. **On this repository the bypass is
the merge path, not an escape from one**, and `main` requires no review so that refusal never fires: sole `CODEOWNERS`
is sole author, GitHub does not let an author approve their own, and `BLOCKED` is not a blocker to escalate. Rule 1,
and every refusal, are in [reference/pull-requests.md](reference/pull-requests.md).

## Press GitHub's own "Merge when ready"

```bash
github enqueue --pr <n> --repo <owner/name> --dry-run          # the whole report, no write
github enqueue --pr <n> --repo <owner/name> [--acknowledge review-not-approved] [--dequeue]
```

**The landing path on a base with a native merge queue** — `merge --admin` above is for a base without one,
or one whose hosted Actions is off (next section). GitHub owns the entry: no hold, no baton. Every reason not to queue
prints as a finding and refuses the write until `--acknowledge <subject,...>` or `--acknowledge-all --reason
"…"` accepts it; a closed, still-draft or unqueued-base pull request is refused outright, since acknowledging
those could not make the write possible. Success is the `mergeQueueEntry` read back, never the write's own word.
Subjects, the `merge_group` trigger CI needs, refusals and `--dequeue`: [reference/merge-queue.md](reference/merge-queue.md). A **native-stack member** takes GitHub's asynchronous merge REST route: [reference/stack-merge.md](reference/stack-merge.md).

## Hosted Actions off: run CI here with `github lap`

`github lap --repo <owner/name> --number <n>[,<n>...] [--dry-run|--land]` runs the whole CI lap locally over a
head containing its base tip (or ONCE over a batch's simulated squash chain), posts `build` and `integration`
through the door, and with `--land` checks the landing FIRST, then lands each under a hold: [reference/local-lap.md](reference/local-lap.md). Hosted Actions is switched OFF with `github actions --repo <owner/name> --disable [--apply]` ([reference/actions.md](reference/actions.md)); ON only under a stated policy, on an approved digest, with `github repo --enable-actions` ([reference/repository.md](reference/repository.md)). While a `github lap-seat` stands, only its run laps; any other seat sends its number and head SHA to the chair: [reference/lap-seat.md](reference/lap-seat.md).

## Hold slopweaver's own merge lane — where no queue can move

`github hold --pr <n> --repo <owner/name> --why "…"` (`--status` flags a gone holder) and `github release --pr <n>
--repo <owner/name> --sha <sha>` once landed. While a hold stands, `github merge` REFUSES every other pull request
there, the report path too (so a report takes `--number <n>`). Not on a working queue, where `enqueue`
serialises without owning a session: [reference/merge-hold.md](reference/merge-hold.md).

## The description format is not optional

Before raising or updating a pull request, read [reference/pull-requests.md](reference/pull-requests.md). It
carries the house format, ONE C3 shape in both repositories — three DERIVED badges, a 70-word explainer, two proof
slots, the checks, a Re-run fold, no grade or anchor — the conventional-commit title and the kind labels it derives,
and where proof media lives. CI accepts an owned pull request's body only as the exact render of a form. Every title, body, self-review comment and commit message crosses the publication scan (no I/we, no installation state, "this machine"), and `stack push`/`pr update` send a description only over a CLEAN `github pr review-prepare`/`review-record` receipt for its exact bytes: [description-review.md](reference/description-review.md).

## Reviews: your own pull request gets a walkthrough, somebody else's a parked review

Leave inline self-review comments on every PR, unprompted, on BOTH repositories — acme-admin above all, where
humans read every pull request. Their job is to make a cold review easier to enter: what to read first, and
why a surprising line is there. Never author receipts, a repeat of the diff, or a long implementation
narrative. Each comment is at most 50 words and names its `kind`, which renders its first character (`behaviour-change` ⚠️, `moved-unchanged` ♻️, `risk` 🚩, `test` 🧪, `explanation` 💡); file names go in backticks, never a pinned link. `enqueue` and `merge --admin` resolve the owner's own before landing. The
strict form, the omission warning and the resolve are in [reference/self-review.md](reference/self-review.md).
**On somebody else's pull request, review BEFORE any reply** — a thanks, an approval, a "looks good": Codex reviews the diff one falsifiable property per pass, each finding is reproduced, and `github review-draft record --repo <o/n> --number <n> --form - --why "…"` parks them as draft line comments on a queue card with the hunk each sits on, posting nothing; risk the review could not settle goes in `deeperReview`, an offer of a deeper review shown to the owner and never posted. `post <id> --approve <digest>` runs only on the owner's word, and the door holds it without that digest: [review-drafts.md](reference/review-drafts.md).

## Managing a native GitHub stack

`stack push` amends and pushes the current commit, opens the pull request from the form and registers it against the
parent named by `target.base`; **`stack restack` rebases every open pull request of yours onto its latest base — the
whole forest, LOCALLY, pushing nothing** ([restack.md](reference/restack.md)); `stack sync` repairs a drifted stack;
`stack adopt` pulls an open one-commit pull request into local stack state (`--register-only` registers a
DRIFTED one's membership and replays nothing); `stack audit --check` lists every chained
pull request WITHOUT a native stack ([chained-stacks.md](reference/chained-stacks.md)). Each takes `--dry-run`;
[stacks.md](reference/stacks.md) has the carry gate and why staleness is ancestry.

## You fill a form. Code emits the bytes.

Never hand-write a pull-request body. Fill the typed form (`--form` JSON, or the markdown `--file` that
`stack push --file-example` prints) and let the renderer produce it — byte-stable, the malformed cases
unrepresentable. Content is a list of typed RUNS (`text`, `strong`, `em`, `code`, `link`), so raw HTML is
unreachable. **`pr update --edit` names ONLY what changes**; everything else is carried from the live form.

**Read [reference/pr-forms.md](reference/pr-forms.md)** before your first `stack push`/`pr update`: the pipeline
and where `--dry-run` stops, the `--edit` fields and the retired ones, the two overrideable locks, and the rules CI checks.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you; in
Codex it is not, so resolve this `SKILL.md` on disk, take the plugin root two directories above it, and
invoke `<plugin-root>/bin/slopweaver` by absolute path. Never run bare `slopweaver` — an ambient `PATH` may
point at another checkout.

Use the bundled verbs, never their raw `gh`/`git` equivalents: `github read <url> --json` for a current object
(historical retrieval discovers a candidate, it never replaces the live read), `github push` for a branch,
`github ready` for a draft, `github merge` as the pre-merge guard, `github enqueue` for the merge queue. Never
hand-write or directly patch a pull-request body with `gh`.

For Slopweaver and any repository whose local authority marks the work as personal: do not create or require a Linear
issue, do not invoke `/ship`, and read the authority file for the exact base branch rather than assuming a team-facing one.
