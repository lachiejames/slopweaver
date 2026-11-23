# The BACKLOG, not one pull request — `github bottleneck` and `github bump-drive`

`github landing` answers what holds ONE pull request. Too many open pull requests at once point to bottlenecks in
the SDLC, and these two verbs answer that backlog question instead — one measures WHERE the queue is stuck, the
other clears the largest cause.

Both run off `readLandingRows`, the same fleet read `github landing`, `github review-state` and session-start
go through. Neither has a read of its own, so the audit, the act and the six tests can never disagree.

## `github bottleneck` — group every open pull request by where it is waiting

```bash
slopweaver github bottleneck --repo lachiejames/slopweaver          # the histogram
slopweaver github bottleneck --repo lachiejames/slopweaver --json   # rows, bars and residue
```

ONE cause per pull request, down a fixed ladder — `queued`, `conflicting`, `draft`, `review-owed`,
`threads-open`, `ci-red`, `ci-running`, `unread`, `clear` — so the bars sum to the backlog and a reader can
act on the biggest one. The ladder's order is the argument: a DRAFT nothing lists outranks red CI on it,
because no sweep and no dispatch verdict reaches a draft at all, and a bump GitHub already holds a queue entry
for outranks everything, because there is nothing here to do.

**Drafts are IN by default, which is the opposite of `github landing`.** That inversion is the verb's whole
point: `landing` excludes them because it acts, and the audit that excluded them would hide the largest bar.

**Two ages, and the second is not the wait.** `openHours` is measured from when the pull request was OPENED;
`idleHours` from `updatedAt`, which a check re-run bumps. MEASURED, one pull request read 149h open and 5h
idle — a row judged on idle time alone would have looked fresh while sitting five days.

**The residue names what the read cannot see.** A board row joins by a declared `branch:` and nothing else, so
for a pull request no handover doc declares, "a seat that ended without landing" is UNKNOWN — said in a line
rather than counted as `clear`.

## `github bump-drive` — the automation that drives dependency bumps

```bash
slopweaver github bump-drive --repo lachiejames/slopweaver --dry-run   # every act, nothing written
slopweaver github bump-drive --repo lachiejames/slopweaver             # act
```

A pull request is a bump on any of three signals — a bump BOT's authorship, a `renovate/` or `dependabot/`
head, or a bump TITLE — and every row says which one selected it, because a title-only selection is the one to
read twice. Then ONE act each:

| act                     | when                                              | what it does                            |
| ----------------------- | ------------------------------------------------- | --------------------------------------- |
| `close-superseded`      | one of THE OWNER'S bumps Renovate already merged, | `github close` with a comment naming    |
|                         | or whose merge into the base is empty             | why — [superseded](superseded-bumps.md) |
| `enqueue`               | all six landing tests passed                      | `github enqueue`, plus a ledger row     |
| `undraft-and-enqueue`   | every test BUT the draft flag passed              | `github ready`, then the enqueue        |
| `rewrite-body`          | a non-Renovate BOT's bump whose ONE red           | recompose the description from the form |
|                         | check is that repository's `dev-gate`             | and send it through `github pr update`  |
| `review-withheld`       | a RENOVATE bump whose only hold is a code         | nothing at all — no row, no Queue card, |
|                         | owner GitHub NAMES                                | never a review ask to a colleague       |
| `awaiting-human-review` | any other bump held only by a named code          | nothing at all — the next pass presses  |
|                         | owner                                             | it the moment that approval lands       |
| `seat`                  | a rebase, other red CI, a reviewer thread         | one row on the ONE board                |
| `held`                  | an opt-out label stands on it                     | nothing                                 |
| `nothing`               | GitHub already holds a queue entry                | nothing                                 |

**A repository GitHub cannot resolve refuses the pass, never reads as zero.** The read is a `search`, which answers a wrong slug with an empty list, so one once printed "No dependency bumps among the 0 open pull request(s)" and exited 0.
Every `--repo` that returned no row is now resolved first; one that does not resolve, or whose check itself fails, prints one line naming the slug and exits 1 before anything is closed or pressed.

**`undraft-and-enqueue` is why the verb exists.** `renovate.json` sets `draftPR: true` and `github landing`
excludes drafts, so every renovate bump here was invisible to the verb that presses. MEASURED
(`slopweaver github bump-drive --repo lachiejames/slopweaver --dry-run`): ten bumps of 25 open pull requests,
and THREE of them were green on all five other tests, one draft flag from landing, with no verb
able to say so.

**No landing test is dropped for any signal, and `awaiting-human-review` is why.** The owner and the fleet
auto-merge every dependency bump pull request of theirs, and nearly any slopweaver one. A bump in either repository is
pressed the moment it is mergeable, and `acme/acme-admin` branch protection wanting a human review is the gap to have
NAMED rather than routed around. So a bump whose only remaining hold is a code
owner GitHub names reads `awaiting-human-review`, the read says **"waiting on a human review"** in those words, and the next pass presses it the moment that approval lands.

**A RENOVATE bump in that state reads `review-withheld`**: no act, board row, Queue card, colleague review ask, or `slack draft record`.
Dependabot bumps and bumps selected only by branch or title stay `awaiting-human-review`; only the registry proves
their opener. A seat still makes a Renovate bump green when it also owes a red check or rebase. Its
`RENOVATE_SEAT_CLAUSE` (`src/cli/commands/github/bumpDriveCore.ts`) stops and names the hold once only the code
owner remains. Settle an existing Queue card asking the owner to review one `declined`. The owner
is withholding that review for now, and the state lasts until the owner's word
ends the hold; that word, not a session, ends it, and the act and this section are rewritten then.

**That hold needs GitHub's own word, not merely an open request**. A bump carrying an
`asCodeOwner` request whose `mergeStateStatus` is `CLEAN`, `UNSTABLE` or `HAS_HOOKS` has its protection
already satisfied — GitHub offers "Merge when ready" on it — so the pass presses it rather than seating it.
`BLOCKED` is the answer that makes the request a requirement. MEASURED over eleven pressed
by hand: ten answered `BLOCKED` and were correctly held; exactly one, on base `staging`, was
mis-read, and the door took it. [landing.md](landing.md) carries the criterion.

It is not a `seat`, and that is the point: a board row is the register of what is IN FLIGHT and no session
here can do a colleague's approval. MEASURED, nine of the 20 open `acme-admin` bumps were in that
state — enough to spend the whole five-row seat budget every pass on rows nothing could ever clear.

**A `bot-author` bump keeps `codeowners-satisfied`.** Judged on `lachiejames/slopweaver` alone, dropping it
looks like a no-op — `slopweaver github landing --repo lachiejames/slopweaver --include-drafts --json` answers
`codeowners-satisfied: pass` on every open row. On `acme-admin` the drop was the whole defect (MEASURED): nine bumps planned `enqueue` and `github enqueue` refused every one with `review-not-approved`, naming
an open code-owner request out to `acme/acme-eng`. The read planned an act the write could not take.

**Pressing a bump is not announcing it.** `bump-drive` sends no Slack post; announcing a bump for review is
`vulnerability-fix digest`, which sends every line and marks it passed only when every evidence leg its row opts
into holds — the E2E label and a `SUCCESS` run on every leg of its current head, a green CodeRabbit; any other
line names what it lacks in round brackets ([the flywheel](../../vulnerability-fix/reference/the-flywheel.md)). A session
hand-posting a bump to `#dev-alerts` marks its lines the same way, and one nobody asked for is parked with `slack draft record` for the owner's yes (rule 10) rather than sent.

**It does not rebase and does not re-run red CI**, and neither is an omission. A rebase is a working tree, a conflict resolution and a force-push; a red check on a bump is a real signal about a dependency.
Both are work for a session, so both become a board row (`AGENTS.md` rule 10) rather than an unattended force-push or a retry loop that would hide the upgrade that should not land.
The session that does that work every day is the seated `bump-fix-slopweaver` row below.

## `rewrite-body` — the one red check a bump-drive pass repairs, and why

**Never on a Renovate pull request.** A renovate-authored pull request keeps the description Renovate gave it, in
both slopweaver and acme-admin — so every Renovate bot (the generic App plus the organisation's own
`dependencyBots`, `src/organisation/dependencyBots.ts`) is excluded, and CI judges a Renovate pull request as a
STRANGER's, by the security scans alone (`prOwnership`, `src/prformat/prBodyGate.ts`). A Renovate bump red only on
`dev-gate` is a `seat`, pressed by hand with its body untouched ([bump-fix](../../automation/reference/bump-fix.md)).

**An owned bot's template is never C3, so it can never go green on the description it opened with.** `dev-gate`
holds every OWNED pull request to C3. MEASURED before the composer existed: three bumps each landed only after a
session retyped the body by hand, so a mechanical edit cost a whole session — a bottleneck worth removing. A
body-rewrite step needing two hatches is CODE, not a door question, because the body is on the owner's own
repository's bot's pull request and is posted as nobody.

The composer is `src/outbound/github/bumpBodyForm.ts` and its own test feeds the render straight into the real
`validatePrBody`, so "this body passes the gate" is checked rather than asserted. Four things are the rule:

- **`tests only`, no grade.** A bump changes nothing on screen, so both proof slots are one-line reasons and the
  proof badge reads grey `tests only`. Its honest proof is the repository's own suite over the lockfile diff,
  linked rather than quoted, which a bot's force-pushed rebase cannot stale.
- **`bot-author` only, `dev-gate` only, and only when a check actually FAILED.** A description a session wrote
  is somebody's words; a second red check is about the dependency; an empty failing-check list with `ci-green`
  failing is a check that never RAN (a conflicting head), whose fix is a rebase. Each of those is a `seat`.
- **ONE rewrite per head, ever.** The autonomy row it writes is the guard — `rewrite-<owner>.<repo>-<number>-<head>`,
  the whole head, read back before the next pass composes anything (`bumpBodyWasRecorded`; a seven-character
  `<number>-bump-body-<short head>` row still guards, on the same pull request's URL only). So a `dev-gate` still
  red afterwards becomes a seat instead of a four-hourly loop, and a ledger the pass cannot READ or WRITE stops
  the act rather than reading as empty.
- **It adds `SLOPWEAVER_ALLOW_FOREIGN_PR` and `SLOPWEAVER_ALLOW_PR_REPLACE` to that one child call**, never
  closes either (`hatch-release`), and every outcome line names both. Both already have rows in
  `src/hatch/repositoryContextHatches.ts`; `foreign-pr`'s exception list names this class. It opens no `pr-evidence-loss`
  grant: a bot's bump body carries no settled ask of the owner's, and one that did would be refused, not waived.

**It acknowledges ONE finding, for one class, and only ever that one.** A BOT's bump carries
`--acknowledge codex-loop-incomplete` with its reason written to the door ledger. MEASURED on the
first live pass: the verb undrafted three bumps and then had all three presses refused on that finding,
leaving each a non-draft that did not queue. Nobody planned a renovate bump and nobody will review one, so the
refusal can never be cleared — a config fact, exactly as a codeowner approval that cannot arrive is
(`AGENTS.md` rule 1), and a verb that stops there gets no bump over the line at all.

It fires on the `bot-author` signal alone, because only a declared bump bot — the generic Renovate and Dependabot
plus the organisation's own `dependencyBots` — carries the claim that no session authored the pull request. A
`renovate/`-prefixed head under an unrecognised login may be a bot this install has not declared or a session that
borrowed the convention, and the fix for the first is to add the bare App login with `slopweaver org set`; an
organisation that will not read stops the pass. **Every other finding still refuses**: a red rollup, a missing required context, an unapproved
review and a non-mergeable head each stop the press, and a bump held by one of those is a bump that wants a
session.

**Every enqueue is written to the AUTONOMY ledger** (`kind: press-merge-when-ready`, subject the pull-request
URL) on the ENQUEUE rather than on the merge: the enqueue is the act this machine took, and a row waiting on a
merge a later push evicts would never be written at all. It is filed under the id `github landing --press`
writes for the same act — `enqueue-<owner>.<repo>-<number>-<head>`, a repeat at one head `…-2` — and an undraft
whose press was refused under `undraft-…` the same way, so a bump pressed again after a rebase or an eviction
is a new row rather than a refused one. **A press or undraft whose row cannot be written is not made**: the
pass asks the ledger first (`ledgerActs`, read AND writable), dry run included, and reports `not pressed` /
`not undrafted` instead.

**Three caps, counted separately** — enqueues, description rewrites and board rows per pass
(`src/cli/commands/github/bumpDriveUsage.ts`). A backlog of conflicted bumps cannot eat the pass's enqueues, and
landable ones cannot stop the board learning about the rest. A capped bump is REPORTED, never dropped: it fires again. **The seat cap counts rows THIS pass registers**: a bump the board already holds is skipped and spends none, so a repeat firing seats the next bumps.

**Take a bump out of the rotation with a LABEL**, not a counter — `--opt-out-label`, default `no-auto-merge`,
compared lower-cased. A label is something a human can attach from GitHub's own interface; an attempt counter
this machine kept would be state nobody can see.

## The automations — ONE DRIVE PER REPOSITORY, and one daily seat

Every row is DECLARED — in the build, or by [registering a team repository](../../automation/reference/team-repository-rows.md)
— and written with `slopweaver automation register-standing`: never by hand, and never only in the store, where
deleting one is silent and permanent.

| row                     | argv                                      | cadence        |
| ----------------------- | ----------------------------------------- | -------------- |
| `bump-drive-slopweaver` | `--repo <the declared checkout's origin>` | `0 */4 * * *`  |
| `bump-drive-<name>`     | `--repo <owner/name>`                     | `30 */4 * * *` |

Both are `verb-run`, `read-write`, `onMissed: skip`. The first resolves per install, and is undeclared when no single checkout does ([declared rows](../../automation/reference/declared-rows.md)). The third, `bump-fix-slopweaver` (`15 8 * * *`), is the
SEATED `bump-fix` kind: its argv is the same drive with `--dry-run`, a worklist a visible session then works
green before it settles the firing ([bump-fix](../../automation/reference/bump-fix.md)). **A row absent from the store, between firings or unschedulable is covered by the supervisor's `tick open`**, which drives that repository itself; a due row is the automation's, a held or disabled one stands ([sweep contract](../../supervisor/reference/sweep-contract.md) step 7).

**Two rows rather than one naming both, and the caps are the argument.** The three caps are per PASS, not per
repository, so a single row reading both would make the two backlogs compete for the same three presses —
MEASURED, `acme-admin` carried 20 open bumps to `slopweaver`'s ten, so fleet order alone would
starve the smaller one. The cadences are offset so the two never fire in the same minute.

**`--repo` is named rather than inherited.** The verb would otherwise resolve whatever checkout the pass ran in, which makes the subject a property of where a session happened to be rather than of the schedule.
