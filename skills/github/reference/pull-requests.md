# Raising a pull request in this repository

Bundled reference for the `github` skill, loaded when the body links here: the procedure for raising a pull request. It lives here rather than in `AGENTS.md` because an assembled `AGENTS.md` truncates before a block this long, and as a skill reference both hosts read it whole.

- One commit off the base branch, opened as a **draft** by `github stack push`. **`pr create` is REFUSED**
  and a chained base must be NATIVE ([stacks.md](stacks.md), [chained-stacks.md](chained-stacks.md)).
- **Not RAISED until its checks have been read once** — `github checks --wait` discharges it, and `handover finish`/`settle` refuse until it is ([checks-read.md](checks-read.md)).
- **You may undraft and merge your own PR once CI is green and the proof is as good as was feasible at the
  time** — then pull `main` so the local checkout is current. Do not wait for the maintainer. The supervisor exercises the same judgement over merging a session's work.
- **A comment-only or trivial fix to an approved, unmerged pull request is pushed onto it**, never split into a second
  review. The exception is an approved pull request that has already merged, where the fix is a new one.
- **Auto-merge is the DEFAULT, not a judgement call**, for every dependency bump pull request and nearly every
  slopweaver one. A slopweaver pull
  request of the owner's that is green, proven and mergeable is enqueued on sight — **no card and no ask row**
  — and a dependency bump in EITHER repository is pressed the moment it is mergeable, by `github bump-drive`
  on a scheduled row per repository ([backlog.md](backlog.md)). The one gap, named rather than routed around:
  `acme-admin` wants a human review, so a bump there reads **"waiting on a human review"** until it lands, a PENDING request not being it ([codeowner-requests.md](codeowner-requests.md)),
  and a RENOVATE one is THE OWNER'S to review, a review the owner is withholding until the owner's word ends the hold, so it reads
  `review-withheld`: no Queue card, never a colleague ask ([backlog.md](backlog.md)).
- **Land with `slopweaver github enqueue --pr <n> --repo <owner/name>` where the base branch has a native
  merge queue.** `lachiejames/slopweaver` `main` has none: a native merge queue is an organisation-repository
  feature, and this is a personal repository. On a queued base you press GitHub's own **Merge when ready**;
  GitHub then tests the entry against the tip and every entry ahead of it, and lands it. Nothing is handed to
  another session and no hold is taken, so a session that dies after queueing costs nothing — the entry is
  GitHub's. Subjects, refusals and `--dequeue`: [merge-queue.md](merge-queue.md).
- **Where the base has NO merge queue, merge with the admin form, every flag required** (`--description -` reads stdin):
  `slopweaver github merge --repo <owner/name> --base origin/main --head <branch> --description - --admin --number <n> < body.md`.
  ADMIN because the config leaves it open, not a rule escaped: the sole `CODEOWNERS` entry was the sole author, so the
  review could never arrive and a plain merge was refused **permanently**, `enforce_admins: false` the other half.
  `BLOCKED` here is a config fact, never a blocker to escalate — why `enqueue`'s `review-not-approved` is
  acknowledged, not satisfied. `main` carries no review requirement at all.
- **`stack push` and `pr request-review` refuse a branch whose board row is a
  fleet FINDING the owner has not ruled on.** A row registered with `handover register --finding` came from what
  a session observed, not from the owner; until `handover rule <slug>` records the owner's words and where the
  owner said them, the refusal (`finding-unruled`, or `finding-declined`) opens by saying what a finding gate IS,
  then names the row, its origin and that verb. No acknowledgement flag — the owner's word is the only way past.
  The gate exists because a pull request once went up on staging from a finding nobody asked for and the
  owner closed it with no memory of asking. **A pull request on THIS repository is not gated**: it opens on the session's judgement, writes an autonomy-ledger row, and stays shut if it cannot; a `declined` row still refuses. `AGENTS.md` rule 10 does not touch this gate.
  Details: the handover skill's [one-board reference](../../handover/reference/one-board.md).
- **`stack push` refuses a DISPATCHED WORKER that owes a public thread an answer** — this session announced
  as the worker for a `channel`-surface ask that still holds an unsuperseded dispatch, which is what "no
  answer posted" leaves behind. Override `SLOPWEAVER_ALLOW_ANSWER_FIRST=1`; answering clears it and is always
  cheaper. The DM carve-out and the blind spot: [answer first](../../loop-bot/reference/raising-a-pr.md).
- **`github push`, `stack push`, `stack submit` and `github ready` refuse a head carrying proof output**, naming each
  file: a `proof`, `proofs`, `screenshots` or `.proof` folder outside source code, a picture or recording named
  for proof or a screenshot, or a `.tape`/`.cast` recording source under ANY name; no pull request needs a proof
  folder. CI holds the same line as `no-proof-path`, every capture verb
  refuses an `--out` inside a checkout, and every spawn writes the ignore block into the repository's own
  `info/exclude` (`src/proofPath/localExclude.ts`). All of it is OUR setup: it never becomes a team-facing
  acme-admin constraint. Proof lives under `$SLOPWEAVER_HOME/proof/<slug>/` and reaches the
  body as an attachment. Override `SLOPWEAVER_ALLOW_PROOF_PATH=1`; the criterion is `src/proofPath/criterion.ts`.

**The refusals `github merge --admin` raises before it lands anything** (not totalled: the admin pair below is one bullet but two refusals):

- **An unmet CODEX PAIRING FLOOR** (`AGENTS.md` rule 9) — no conclusive STALE `READY` plan, no CURRENT review, or **no
  checkout on this machine holding the pull request's head commit**. The floor judges the PULL REQUEST: every checkout
  of the repository holding that commit is folded, so plan in one worktree and land from another. Acknowledge
  `codex-loop-incomplete` with a reason. Past the second and last review pass a standing BROKEN is a leftover:
  `codex status --check` names each, it stays that same finding, and only `--acknowledge codex-loop-incomplete
--reason` lands it, the reason in the door ledger. No description carries it. A CAPPED or unregistered Codex never holds a landing: Claude fallback receipts ARE
  the plan and review; only unplanned work rides that acknowledgement ([reference](../../codex/reference/claude-fallback-review.md)).
  **`baseline-bump-unwitnessed`** (enqueue too): every loosened ratchet row needs a bump record in the state home
  (`dev baseline-bump`) with a CURRENT CLEAN Codex witness of its claim, counted in its own lane past the two passes; no acknowledgement or hatch ([why](../../../docs/toolchain/rebaseline-and-lanes.md)).
- **A base that REQUIRES A REVIEW** — classic protection's or a ruleset's `pull_request` rule, read live and unioned;
  a classic 404 read as `unprotected` and PERMITTED it. The measurement is in the rationale doc.
- **Not an admin**, **`enforce_admins: true`**, a **DENIED protection read** — each refused alone ([local-lap](local-lap.md)).
- **A required context that never ran** — the bypass merges past protection, and the rollup counts only runs PRESENT,
  so an absent required check reads `SUCCESS`. Named in the refusal; rebase or re-trigger. Why a FAILED check is not
  refused: [merge-queue.md](merge-queue.md).
- **`base-moved`** — the base advanced since your last push, so `--admin` would land on something CI never
  tested. That, `base-unresolved`, and the non-blocking `⚠ this branch is N commits behind <remote>/<base>`
  every git-reading verb prints: [base-freshness.md](base-freshness.md).
- **A head or base that disagrees with GitHub** — a report measured from local refs that describe a different merge is refused, never warned about.
- **A private term on a line the merge lands**, `--dry-run` included — a hit or an unreadable terms file holds with no acknowledgement; an absent one is `private-terms-unchecked`, named with a `--reason` ([the landing sweep](../../../docs/security/private-terms.md#the-landing-sweep)).

**The docs budget is re-measured on the MERGED tree, not either branch's tip.** `github merge` runs the
always-on documentation set and every skill body through `git merge-tree`, so a `docs-budget` finding names the
measured number when your pull request plus what base gained in flight crosses a ceiling neither crossed alone.
`--admin` re-checks it after the merge lands, against a fresh fetch, publishing a `main-gate-failed` alert to
the supervisor stream (`docs/supervisor-events.md`) on a crossing.

**Every report is taken against the FETCHED base tip, and says which tree it read** (`measured in tree:`/`measured
base:`/`measured head:`); why, and a fetch that cannot run: [base-freshness.md](base-freshness.md).

**`reverts-main` names a commit, and claims nothing about your fork point.** It reports that base's own history held
exactly the content you propose at `<sha>` and its tip holds something else, so merging restores the older version.
A fork-point claim is false on a cleanly rebased branch (measured), and a false finding stops being read. A `reset --soft` revert and a deliberate one leave
the same git graph, so nothing separates them: read the named commit and say which it is.

**On a serial landing, queue — do not hold.** Several ready pull requests converging on one base is a serial landing,
and a lap lost to `base-moved` (rebase, re-validate, push) costs roughly 8 minutes of local gate plus a CI run.
Neither `push` nor `stack push` charges one on a gated queue ([the merge hold](merge-hold.md)), and `enqueue` removes
the merge-time lap, evicting the entry that actually fails rather than making the next author rebase.

**Why not a hand-run hold lane.** That shape is `github hold` before the first rebase, one gate lap inside it,
then a baton naming the next pull request AND its receiving session. MEASURED
over a backlog of open pull requests: service time was fine at
24.5 min/PR, but the lane sat **idle 41% of the day (371 of 905 minutes) behind a stalled or parked holder**,
once for 199 minutes, and the median open→merge was 8.49 h against a 0.33–1.88 h baseline. The cause was
head-of-line blocking with **no liveness check on the receiver** — a hold belongs to a session and a baton by
name cannot notice one dying. A queue entry belongs to GitHub, so the same death costs nothing.

**`hold`/`release` are only the advisory lane for a base branch with no queue** ([the merge
hold](merge-hold.md)), or for the one real exception on a queued base: a proof that is an expensive live
measurement a moved head would invalidate outright.

**Green CI is not negotiable. The grade is a judgement.** `gold` is
preferred and is what you reach for, and `silver` or `bronze` may be merged when gold genuinely was not
feasible at that point. A red or missing CI run still means it is not yours to merge, whatever the grade. The
grade is a landing judgement kept off the description: a C3 body publishes no grade, anchor or origin.

Four things follow, and the third is the one agents get wrong:

- **"Not feasible" is a judgement, not a checklist.** It is never pinned to a
  mechanical heuristic, so do not invent one and do not ask for one. State in the PR why gold was not
  reachable at the time, as a **Not checked, and why** item; that sentence is the artifact, and a reviewer can disagree with it.
- **A merge below gold leaves gold OWED, not waived, and the tracking is a verb.** Your why-not-gold sentence IS the debt entry: after you land, record it with `slopweaver gold owe <pr-url> --grade silver|bronze --would-be "<that sentence>" --blocked-on "<what has to pass first>"`. It gates NOTHING — merging is never delayed — and the supervisor sweep settles it with `slopweaver gold settle` once the blocker passes, so a
  silver merge is a deferral you expect to be asked about, not a discount.
- **Reaching for silver because gold is inconvenient is not the same as gold being infeasible.** If the
  evidence could be gathered with more work, gather it. The ruling widened who may judge, not how much
  proof the work deserves. This is the grade's judgement at landing, so a description review never refuses a
  true proof reason for a capture it thinks could have been taken.
- **The witness is yours to take, never the owner's to give.** Take the gold proof yourself under graduated
  autonomy, never block work or escalate to the owner for a proof witness.
  When the proof needs a human half — a reply under a bot post, a message as the owner — a session posts it AS THE
  OWNER, in a thread or the owner's bot DM, addressed to the BOT and never to a colleague (a witness only a message to a person could give is parked for the owner's yes, rule 10), and a visible session takes the other half. Real traffic counts: a turn the
  bot already answered, a door row the gate already wrote. So a `--blocked-on` never reads "the owner's approval"
  or "the owner's reaction", and no card, hand step or ask row exists to get a witness out of the owner — `hand
post` refuses a step whose `--unblocks` names a proof (`proofWitnessStep`, `src/hand/step.ts`), and `slack draft record` will not park one sent to the bot in the owner's bot DM (`botDmWitness.ts`; a witness is never escalated to the owner or blocked on the owner).
  Inviting the owner to TRY what landed is still wanted; that note names what it gives the owner, never a proof it would
  finish. Worked examples: `slopweaver gold debts --settled`.

`gold` is the grade nobody can simply assert. **Evidence is a real capture, never made**, and a proof line names its
window and same-seed evidence or says "evidence suggests" ([proof-evidence](proof-evidence.md)).

**On a clickable surface, click the shipped control through before merging**: on the checked-out branch, drive the
Playwright browser against the running build, check it opens the page you intend, fix until it does; the screenshot of
where it went is Proof of the solution. A `desktop/src` change is clicked through on the real app, `desktop e2e
--app`: [click-through](click-through.md).

**The title is a conventional commit that says the outcome** ([pr-titles](pr-titles.md), refused at the door otherwise).
**The form's test is the owner's one sentence** ([composing a body](composing-a-body.md#the-test)): a real problem,
code that solves it, proof the owner can trust, and little effort to read. A cell that does not help show those, quickly, comes out.

**Description format — ONE shape, C3, every PR, BOTH repositories.** `stack push --file-example` prints a filled
one; a hand-filled body fails `pr-format`, which accepts only one that parses and re-renders byte for byte
(`src/prformat/prBodyGate.ts`). The layout is `src/outbound/github/render.ts`:

1. **Three badges, DERIVED, never authored**: `risk` (the top-ranked item's level), `problem` (`seen <day>` or
   `not seen yet`) and `proof` (five values from the two proof slots, never red). Each hover is plain text of at most
   200 characters: [pr-badges](pr-badges.md).
2. **The explainer**, at most 70 words: what broke, for whom, and what this changes, in plain sentences.
3. **Proof of the problem** and **Proof of the solution**: each a real screenshot under the one line (≤25 words) it
   proves, with who ran it, or a public reason there is none, capped in
   [composing a body](composing-a-body.md#the-cells-the-badges-read), its heading then reading `: not shown`.
4. **Checks**, a list of one sentence per check with no screenshot (≤25 words), a labelled group nested under its
   label after the base checks, then **Not checked, and why**.
5. **Re-run**, the one fold: only what re-runs it (commands, test lists, short notes).

The headings are `##` (layout 2). A body published before the description ruling reads back in its own layout 1
(`###` headings, checks as paragraphs) and is never judged by the content rules ([composing a
body](composing-a-body.md)); editing one re-renders it in layout 2, so its words meet those rules first.

- **No grade, gold anchor, origin, reviewer table or Codex leftover is published**; each is refused by name.
- **Media is evidence, so it is never folded**: a screenshot or video is an `image` run, at an optional `width` of
  64–2048 pixels, in a proof slot. A REAL capture, never a locally served page bar a click-through of the console's
  or desktop app's OWN branch build, hosted as a user attachment, never a release, comment or committed folder
  ([attachments](attachments.md)). Media pasted inside a body is not kept ([pr-forms](pr-forms.md)).
- **Kind labels follow the title**: `stack push` and `pr update` add what the conventional-commit title derives
  (`src/outbound/github/kindLabels.ts`) and read them back; CI refuses an owned pull request missing one.
- **The generators write this shape**: `github vuln body` ([vulnerability-fix](../../vulnerability-fix/SKILL.md)) and
  `bump-drive`'s `rewrite-body` ([backlog](backlog.md)). CI holds an OWNED pull request to C3; a stranger's (a fork,
  Renovate, a GitHub App the organisation record does not name) gets the security scans alone.
- Keep the body **lean**: anything non-obvious goes in an **inline review comment on the diff**. CodeRabbit is
  disabled repository-wide, so it is never the reviewer here ([coderabbit.md](coderabbit.md)).
- Agents must **leave inline self-review comments on every PR of the owner's, on BOTH repositories**, unprompted: what
  to read first, and why a surprising line is there. The acme-admin pull requests need them most, because humans
  actually look at every one there. Plain-English wayfinding beside the code that matters; never author receipts, a
  repeat of the diff, or a long narrative moved out of the description. Run `slopweaver slack voice-rules` first.
  After the diff changes, post a fresh round and resolve only the previous Slopweaver-owned round; never guess at a
  human thread. Omission WARNS on `stack push` and `landing --author @me`, never refuses ([self-review](self-review.md)).
- **Every self-review comment is resolved by its author before the pull request lands**, because otherwise
  the pull request stays stuck open on comments that are not actually callouts: `enqueue` and `merge --admin`
  resolve the owner's one-voice notes just before the press ([self-review](self-review.md#every-walkthrough-is-resolved-before-the-pull-request-lands)).

**Everything above the fold is gated, and the gate REFUSES rather than trims.** The fold is Re-run, so every
other authored cell, the badge hovers included, goes through the above-the-fold gate
(`src/outbound/github/aboveFold.ts`) and the Re-run notes and test lines draw warnings: the operator's exact voice
rules (an em dash among them), no colon-introduced list, no semicolon-joined clauses, at most one parenthetical
aside, no sentence over 30 words. `slopweaver hatch open voice-rules --reason "<why>"` sends one deliberate exception unchanged and says
so. Measured over a voice exercise, it refuses both cells the owner called unreadable and neither fine one.
**Composing the cells is the half no gate can decide**, and the sentences are the owner's: run `slopweaver slack
voice-rules` first, and open the explainer on what broke and for whom; no first person ([composing a body](composing-a-body.md)).
The examples and `pr update --pull` print that brief before you draft.

## The per-verb procedures live next door

Who a dependency-bump batch post asks — one default reviewer per line in turn, a covering person only when codeowners force it, never a group — is [dependency-bump-reviewers.md](dependency-bump-reviewers.md). Marking a draft ready, requesting review, retargeting a base, removing or dissolving a native stack, labels, code-scanning alerts, review threads and top-level comments each have their own outcomes and refusals:
[pr-operations.md](pr-operations.md); the merge hold has [merge-hold.md](merge-hold.md). Pressing GitHub's own "Merge when ready" — the guard's findings (including the recorded `codex-loop-incomplete`), the four refusals no acknowledgement clears, and the
`mergeQueueEntry` witness — is [merge-queue.md](merge-queue.md).
