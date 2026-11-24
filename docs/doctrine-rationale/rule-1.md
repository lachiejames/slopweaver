# Rule 1 · Land your own work

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The rule could have read **"CI is green AND the proof grade is `gold`"**, full stop, with anything short of that
pair staying a draft. It does not, and this is why.

**Why gold is preferred rather than required.** The absolute version is measured failing in one night: three
separate sessions held finished, green, silver work rather than merge it, and each escalation cost the owner a
context switch to approve something already approved in general. A bar nobody can clear on ordinary work is not a
quality mechanism, it is a queue. So gold is preferred and is what you reach for, silver or bronze may be merged
when gold genuinely was not feasible at the time, the gold is still OWED rather than waived, and judging
"feasible" is a judgement call deliberately not pinned to a mechanical heuristic. The green-CI half is not a
judgement.

**What the rule does NOT loosen, and is the part to hold on to.** It widens who may judge the proof, not how much
proof the work deserves. Reaching for silver because gold is inconvenient is not gold being infeasible. The
obligation in place of a hard gate is to SAY, in the pull request, why gold was not reachable — a sentence a
reviewer can disagree with, which is worth more than a grade nobody reads.

## How this ruling arrived, recorded because the next reader deserves to know

This is the one paragraph in this file about provenance rather than substance, and it is here because the rule
loosens a rail and the evidence for it is imperfect.

The ruling reached the session that wrote it as a **relayed quote** from the supervisor chat, which is exactly the
form [cross-session-messages.md](../../.claude/rules/cross-session-messages.md) says does not carry a tier-3
authorisation. The session refused it twice on that basis before the anchor arrived, and then checked the anchor
rather than accepting the relay: the supervisor workspace did contain a genuine owner voice dump at the stated
time, in the owner's unmistakable dictated voice, with the supervisor visibly deriving four separate rulings from
it and dispatching them to four sessions. That is something this system could not have produced, and it is why the
rule landed.

**But the words themselves are not verified.** The voice dump arrived in that chat as an IMAGE, readable by the
supervisor and by no one else, so the relayed sentences could not be checked against a transcript. The rule above
is therefore a PARAPHRASE of a ruling, deliberately not a quotation — putting the owner's words in quotation marks
here would assert something nobody confirmed. If the wording is wrong, it is wrong in the direction of the reading
the supervisor relayed, and the owner should correct it.

The session that landed this also declined to be the change's first beneficiary: it left its own pull request a
draft rather than self-merging under a permission it had just written. Writing a rule and cashing it in the same
act is how a widened permission stops being reviewable.

## Merging is an ADMIN merge here, and that is the configuration, not a workaround

MEASURED: a pull request was refused a plain squash merge — `reviewDecision REVIEW_REQUIRED`,
`mergeStateStatus BLOCKED` — while three earlier ones the same day had merged plainly, so the first reading was
that the branch-protection config had drifted. It had not. Read live: `CODEOWNERS` was `* @<owner>`,
`require_code_owner_reviews: true`, `required_approving_review_count: 1`, `enforce_admins: false`, and the only
rulesets on the repository were enterprise/org ones about visibility, transfer and deletion — none of which touch
merges. Every pull request in the repository's history was authored by that same sole codeowner, and **not one had
ever received an `APPROVED` review**; every review on record was `COMMENTED`, from the author or from a bot,
neither of which can satisfy a codeowner requirement, and GitHub does not let an author approve their own pull
request at all.

So that gate was not sometimes-unsatisfiable, it was **structurally** unsatisfiable. The earlier plain merges were
not a different policy the config drifted away from — they simply predated the protection being applied.
`enforce_admins: false` is the deliberate other half of that: agents admin-merge their own green pull requests
here.

Two things follow, and the second is why this is written down rather than remembered:

- **The admin bypass IS the mandated merge path on a base shaped like that**, not an escape from a rule. A session
  that treats a `BLOCKED` merge as a blocker to escalate is parking on a refusal that can never clear, and that is
  the exact cost — a context switch for the owner — that rule 1 exists to prevent.
- **It has to be an explicit option, never a default.** The admin landing, every flag required,
  `slopweaver github merge --repo <owner/name> --base origin/main --head <branch> --description - --admin --number <n> < body.md`,
  merges only after the guard's own report is clean, refuses separately when the token is not an admin and when the
  protection carries `enforce_admins: true`, and remeasures base freshness against a freshly fetched remote tip
  first. A silent bypass would be the same capability with none of the visibility.

**Re-measured, the config has MOVED since.** `lachiejames/slopweaver` `main` carries **no
`required_pull_request_reviews` object at all** — only `required_status_checks` (`build`, `integration`) and
`enforce_admins: false`. So the reading above is history rather than current state: nothing on this repository's
own base requires a review, so an admin merge is allowed here but never needed for a review. The paragraph is kept
because it is why the flag exists; its numbers describe the earlier configuration and must not be re-cited as
today's.

**Why the review requirement went, and the protection in its place.** It could not survive the move to the merge
queue: an admin bypass is honoured only by a direct merge, never by an enqueue, so a review the sole author can
never satisfy kept every one of the owner's pull requests out of the queue. What protects `main` is a classic PUSH
RESTRICTION allowing the owner alone, which also refuses a colleague's merge or enqueue while the owner's own keep
landing — read it with `slopweaver github push-restriction --repo lachiejames/slopweaver --json`; the research is
in [push restriction](../../skills/github/reference/push-restriction.md).

## `--admin` is never a route into a base that requires a review

A session must never offer to admin-merge a pull request into the work repository when code owners is not passing
or it lacks sufficient reviews. That repository is the thing that goes out to customers and carries real risk if
it breaks, and an admin merge there is not only irresponsible but structurally impossible, because code owners is
in force through the branch's protection.

MEASURED, and it is what turns the rule into a mechanism rather than a preference. GitHub's classic
branch-protection endpoint can answer **404** for a branch that is nevertheless protected by a repository
RULESET — so `../../src/corpus/github/writeMerge.ts` reported such a branch `unprotected` and the preflight
printed _"carries no branch protection, so this merge needs no bypass"_ and **permitted the merge**. The
ruleset's `pull_request` rule (with `require_code_owner_review: true`) and its `bypass_actors` list are the
authority. `enforce_admins` is a field of classic protection and waives nothing a ruleset carries, and admin
permission bypasses a ruleset only through that ruleset's `bypass_actors` list — so the merge being offered
was one GitHub would refuse, on a branch that reads as ungated to anything that only asks the classic
endpoint.

Two gates follow, and neither is a review note:

- **The door.** `github merge --admin` reads BOTH mechanisms, unions them, and refuses a base that requires any
  review, naming which mechanism carries it (`src/live/github/reviewRules.ts`). An unreadable answer is a printed
  note, never a permit.
- **Every card.** The fleet-briefing form schema and `briefing check` refuse the phrase in `options`, `lean` and
  `if silent`, on both groupings (`src/briefing/adminMergeOffer.ts`). `what` and the folds are out of scope on
  purpose: a card explaining this change has to be able to name the flag. The refusal is not scoped to one
  repository — rule 1 already says a session lands its own green pull request here without asking, so an
  admin-merge option does not belong on a card for this repository either, and narrowing what a card may say never
  needs anyone's authority.

## The press cap that made the owner's word wait

A `PRESS_CAP = 3` on `github landing --press` would let one invocation press at most three pull requests,
whoever's they were, and report every further green row _"not pressed: this invocation's cap of 3 was already
reached — run it again"_. The reason behind such a cap is sound — the supervisor should perform a handful of clicks
it already has the information to make, and a run that queued twenty pull requests at once would be an unattended
landing wave nobody asked for.

**Why there is no global cap.** MEASURED: seven approved dependency bumps were ready at once, and the chair pressed
them two, two and three at a time across three runs, each pass telling it to run again. Every one of those presses
was already decided: rule 1 says the owner's green, mergeable pull request is enqueued on sight and a bump in either
repository is pressed the moment it is mergeable. If something is ready to merge now, pressing it is one of the
things the supervisor does. A cap on a decision the owner made in advance does not bound risk, it rations the
owner's word across ticks.

**What does the bounding instead.** `src/review/landingPressSelection.ts` splits the pressable set. Every row of an
`--author @me` read, and every dependency bump by any of `bumpSelection.ts`'s three signals, is pressed in the one
pass. A row that is neither — a colleague's green pull request a wide `--repo` read reached — keeps the number as
`NON_OWNER_PRESS_CAP_PER_REPO`, per REPOSITORY, which is the part of the cap's reason that still holds. A row that is
not green is never at issue: `pressable()` requires all six landing tests, and the split selects only from its
answer. The bump signal knows one extra spelling so that "every bump" is true: the fleet read is GraphQL, which
names the Renovate and Dependabot Apps `renovate` and `dependabot` without REST's `[bot]` suffix, so
`bumpSelection.ts` honours those bare logins when GitHub typed the author a `Bot`. Each pressed row still gets its
own head and conversation re-read immediately before its click, so the request count grows with the presses rather
than stopping at three.

**The ledger half.** A press's autonomy row keyed `<number>-enqueue` collides: the ledger refuses a second row under
a held id with different fields, so the second press of one pull request at a new head, or a same-numbered pull
request in the other repository, would lose its row and report that the owner's briefing will not show it. The id
is `enqueue-<owner>.<repo>-<number>-<head>`, the head whole and the witness naming it too. Codex reviews built the
rest of the class: one commit pushed to two repositories shares a head, two heads can share a 12-character prefix,
two repositories' 12-character digests were brute-forced equal, and a repository owned by `class` would have opened
on the ledger's reserved `class.` prefix. So nothing in the id is shortened, and it always opens on `enqueue-`. A
repository the ledger grammar cannot spell one-to-one, or an id too long for its 80 characters, becomes `enqueue-`
and the whole sha-256 of repository, number and head. The repository and head are lowercased in the id, the
subject URL and the witness alike: a GitHub name and a hex object id each name one thing however they are cased, so
two spellings of one press write one row.

A head in the id still names a HEAD, not a press. MEASURED: three `acme/acme-admin` pull requests were each pressed
twice at one head minutes apart, the queue having let the first entry go, and every second row was refused. So a
repeat at a held head is `…-2`, `…-3` (`pressOccurrenceId`, digested past 80 characters), and an id held by an
IDENTICAL act is reused so a retried write stays one row. And because the ledger is the rail, the press reads it
and checks it writable BEFORE pressing, and refuses the press when it cannot; only a write failing after that check
still reports that the press happened and the owner's briefing will not show it.

`github bump-drive` keeps its own `BUMP_ENQUEUE_CAP = 3` — an unattended recipe firing is a different caller — so a
chair that wants every ready bump queued now runs `github landing --press` rather than waiting on the drive's next
firing.
