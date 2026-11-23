# The DISPATCH verdict: what the supervisor DOES about a landing row

Bundled reference for the `github` skill, linked from [landing.md](landing.md): read it to trust, extend or dispute a verdict.

A supervisor boot read must carry enough that the supervisor dispatches the obvious act to a
spawned session **itself**, and interrupts the owner only for the one it cannot: the right information in front of
the supervisor, and good judgment. It is `AGENTS.md` rule 10 applied to one surface.

## The verdicts, and the three ways a row has none

`DispatchVerdict` is the owner's closed set: the six the owner named, then the two below. `LandingAction` has thirteen arms and
is untouched — this is a second, coarser layer on top of it, and `--press` still reads `LandingAction.press`
alone so a verdict can never widen what gets written.

A handful of words cannot represent thirteen acts, so `DispatchDecision` carries three non-act kinds a consumer
can tell apart rather than one fallback that hides the difference:

| kind              | means                                          | rows                                                                              |
| ----------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| `act`             | one of the owner's verdicts, with the sentence | see the ladder                                                                    |
| `waiting`         | a deliberate hold; nobody is owed anything     | `queued`, `pressed-not-queued`, `stacked`, `opted-out`, a draft a live row holds  |
| `outside-the-set` | real work no verdict names                     | a base branch with no queue to press                                              |
| `unread`          | evidence this run could not establish          | a conflict nothing measured, an unbounded Slack window, `landing`'s own `unknown` |

## Nothing the owner owns goes stale

Every open pull request of the owner's carries an act or a named wait, on all five surfaces (MEASURED: of the
owner's 31 open `acme/acme-admin` pull requests, 6 drafts and one other read `outside-the-set`). The owner's steer bounds both verdicts: an unasked send to a person, or an
evidence-backed close of something team-facing, is a queue card, never an act. **Both fire only on a read
scoped `--author @me`**; anybody else's draft or unasked pull request is `outside-the-set`, naming its author.

- **`draft-first-review-ask`** — nobody was ever asked for a review. The session resolves any human thread
  waiting on us. Then, **leading with the discussion**, with no agreed discussion or obvious bug it parks a discussion opener and no ask (`slopweaver knowledge recall review ask reviewer --domain review`); else it drafts the FIRST ask to a named person, never a team or a channel, and parks it for the owner's yes with `slack draft record --reviewer <new|in-thread> --act review-ask` ([its shape](../../slack/reference/the-list-form.md#where-the-ask-goes)).
- **`finish-or-card-close`** — a draft no LIVE board row holds. The session reads the linked Linear
  ticket, any merged pull request superseding it, and the branch; still wanted, it finishes it unasked; dead on
  the evidence, it records a shaped close card and never closes it. **Age is never evidence either way.** A
  draft a live row holds is `waiting`, naming it; a terminal status holds nothing, an unknown one counts as
  live (`src/review/landingBoard.ts`), bar a run parked at rest with NO wake, which `handover wake` never reseats:
  its draft is `finish-or-card-close`, naming `cmux spawn <slug>` (`src/review/landingDispatchDraft.ts`).

## The ladder

1. **`opted-out` → `waiting`; `draft` → `waiting` under a live row that is not parked with no wake, else `finish-or-card-close`.** A human
   already settled an opt-out, and a draft is not yet asking anybody to review it. Both outrank the judgment
   arm: carding a question over a pull request the owner labelled `no-auto-merge` is a card the owner did not ask for.
2. **Any judgment signal → `needs-owner-judgment`**, combining every one observed. See the next section but one.
3. **`conflicting`** — any MEASURED local merge is `rebase-and-fix`, clean or naming paths, approved or not;
   measuring nothing is `unread`. A conflict is never the owner's card.
4. **`spawn-ci` → `rebase-and-fix`**, **`spawn-coderabbit` → `coderabbit-loop`** unless the press re-requested
   it ([coderabbit-nudge.md](coderabbit-nudge.md)); a session judges each thread by [coderabbit.md](coderabbit.md). An ADVISORY-only red never reaches `spawn-ci`: it
   passes `ci-green`, so the row reads its real hold or `press` ([landing.md](landing.md)).
5. **`queued` / `pressed-not-queued` / `stacked` → `waiting`; `no-queue` → `outside-the-set`;
   `unknown` → `unread`.**
6. **`answer-threads`** — only a BOT waiting is `coderabbit-loop`; a human waiting with a code owner pending
   and nobody ever asked is `draft-first-review-ask`; a code owner pending otherwise, or a chase already due,
   is `resolve-then-bump`; otherwise `resolve-then-merge`, an advisory-only red included.
7. **`blocked-on`** — shared with a channel, nobody named: green or yellow `waiting`, unknown `unread`, red
   falls through ([human-wait.md](human-wait.md)). Nobody asked is `draft-first-review-ask`. A chase DUE is
   `resolve-then-bump` if the Slack window bounds the silence, else `unread`. `too-soon` or `replied` is `waiting`
   (a code owner nobody may chase yet is a wait, not work); anything else is `unread`.
8. **`press` → `merge-now`.**

## The terminal evidence gate

The verdicts split in two, and the split is the whole reason this layer is safe.

- **Non-terminal session acts** — `rebase-and-fix`, `coderabbit-loop`, `draft-first-review-ask`,
  `finish-or-card-close` — name visible work a session can start now and claim nothing about what happens
  after, so an unread fact further down the row cannot make one wrong. They bypass the gate.
- **Terminal verdicts** — `merge-now`, `resolve-then-merge`, `resolve-then-bump` — each promise an END state (a bump's is the chase PARKED with `slack draft record` for the owner's yes, never sent: rule 10),
  so each is issued only when nothing material is unread. An unmet fact turns the decision into `unread`
  naming which one: `mergeable`, `conflict-measurement`, `checks`, `check-contexts`, `reviews`, `threads`,
  `review-requests`, `labels` or `landing-test`. `labels` is there because the opt-out is the one control a
  human attaches by hand: a capped label page would hide a `no-auto-merge` and read as a green.

`needs-owner-judgment` passes through neither: it dispatches nobody and asks the owner, so an unread fact elsewhere is
a reason to card it rather than a reason not to.

**Base distance is deliberately NOT a gate.** A merge queue tests the branch merged with current base, so
MEASURED, one pull request read `press` at **400 behind** beside another at **0 behind**. What a verdict may
not do is CLAIM the distance was measured, so `rebase-and-fix` says "it is N commit(s) behind", "it is level
with its base" or "how far behind was not read — rebase only if it is", and never guesses.

## `needs-owner-judgment` fires on STRUCTURE, never on what a reply MEANS

Whether a reviewer's pushback conflicts with what the owner asked is the owner's call, and it is **semantic**: no
pure function decides it, and [pr-state-detail.md](pr-state-detail.md) is the precedent — a sentiment classifier
was thrown out in favour of structural facts plus the owner's own judgement. So the arm fires on two things that were
actually observed, each named for what it saw:

- **a reviewer spoke LAST on an open thread** — exactly what `dispositionOf`'s `reviewer-replied` establishes,
  and the row says in its own words that it does not judge whether they conflict with what the owner asked. It does
  NOT prove the sequence reviewer → us → reviewer; it proves the last comment is not the author's on a
  multi-comment open thread.
- **a standing `CHANGES_REQUESTED`** — a human whose LATEST opinionated review still asks for changes, read
  from the raw reviews rather than from `reviewedSinceAsk`, which is empty whenever no Slack ask was found.

**A merge conflict is never the owner's card.** The fleet resolves conflicts on the owner's pull
requests, markdown included, and only a MATERIAL change to what one does or its risk reaches the owner. The seat
resolving it judges that, so a named-path conflict is `rebase-and-fix` whose `why` names the paths and says to card
the owner only on a material change, naming it.

**The catch that proves it, MEASURED.** One `acme/acme-admin` pull request read `press`, and
`--press` would have queued it. Its four opinionated reviews:

```
<instant 1> coderabbitai   CHANGES_REQUESTED  <sha>
<instant 2> reviewer-a     APPROVED           <sha>
<instant 3> coderabbitai   APPROVED           <sha>
<instant 4> reviewer-b     CHANGES_REQUESTED  <sha>
```

`reviewer-b`'s is the latest human opinion and nothing withdrew it, while GitHub holds no `asCodeOwner`
request on the pull request — so all six landing tests passed. It is the ONE row of 23 carded, against 12
the supervisor may dispatch on its own. Reproduce with
`slopweaver github landing --repo acme/acme-admin --author <login> --json` and read a row's
`standingChangesRequested` beside its `action`.

## The row's own facts

The second line under every pull request carries what the verdict turned on:

```
#<n>      spawn-coderabbit    green    CHANGES  —            none?   5 unresolved CodeRabbit comment(s) …
          coderabbit-loop · cr 5 open (1↤ 0↦ 4↩) 42 done · hu 0 open (0↤ 0↦ 0↩) 0 done · base +10/-255 · ask in Slack: yes, replied
```

**A thread's side is decided by who OPENED it**, so a colleague replying last on a CodeRabbit thread is counted with the bot's. MEASURED over 214 threads on the owner's open pull requests, that happened **zero** times — which is why the grouping stays on the opener. **But zero-today does not license walking
past it**, so the judgement layer counts that shape directly off the threads and escalates it to THE OWNER: a
person pushing back is the owner's to read whoever opened the thread, and a `coderabbit-loop` session sent at one
answers the wrong reviewer. It is a fourth escalation signal, not a change to the tallies. MEASURED over the owner's 25 open pull requests: **four** carried an open CodeRabbit thread, exactly
**one** carried an open human thread, **one** carried a standing `CHANGES_REQUESTED`, and **none**
carried a reviewer who had spoken last on an open thread — so of the four escalation signals only the second
one fired in that read. `cr` and `hu` are the conversation counted for CodeRabbit and for humans **apart**,
because they dispatch to opposite places — `open (awaiting-us↤ answered-open↦ reviewer-spoke-last↩) resolved`. Both are grouped from
the dispositions `prStateDetail.ts` already computed; nothing re-classifies a thread. The author's own one-voice
`--self-review` walkthrough threads are in neither side; the row counts them separately as `oursResolvable`,
because GitHub holds the MERGE on them and the press resolves them itself ([self-review.md](self-review.md)).

`base +ahead/-behind` is one aliased `compare` for the whole fleet, read by ref NAME — so it describes the head
BRANCH's current tip rather than the commit the six tests were computed at. That is safe precisely because the
distance gates nothing; pinning it would hand a reader a stale number instead of a current one: MEASURED over 30 pull requests, **one
round trip, 2,614 ms, a 5,492-byte query, `rateLimit.cost` 1 of an hourly 5,000**. It cannot ride on the fleet node selection —
`compare` takes an argument and a GraphQL argument cannot reference the sibling `headRefName`. One
unresolvable head ref fails the WHOLE request, measured, so a failing request is HALVED and retried down to
single aliases; only the pull requests that genuinely cannot be resolved read `unread`.

`ask` says whether the Slack legs found an ask (`in Slack: yes|no|unknown`) and what the cadence verdict is. It
never counts GitHub review requests, which are not asks ([review-state.md](review-state.md)).
The pending code owners GitHub enforces are in the row's own `BLOCKED ON` cell on the acts that print it —
`blocked-on` and `answer-threads`. The verdicts say **"an ask-like message was found"** and **"a chase is
DUE"**, never "a bump was sent" — `SlackMention` has no ask-versus-bump kind, and claiming one would be an
unverified heuristic on a field a verdict rests on. `mergeable` is three-valued, and a first read is the one most likely to
miss: [mergeability.md](mergeability.md).

## What the dispatch layer puts on the WRITE

**`--press` never presses a row the dispatch layer sends to THE OWNER.** The two answers are independent: all six
tests can pass — `press` — while a colleague's standing `CHANGES_REQUESTED` makes the dispatch
`needs-owner-judgment`. That is exactly the shape of the catch above, and a selector reading the act alone would have gone on
pressing it while the table said it was the owner's. Narrowing is safe: it can only ever press fewer pull requests.

**And it re-asks immediately before the write, because that filter reads a SNAPSHOT.** Two of the three
judgement signals live entirely in the remote conversation — a reviewer holding the last word on an open
thread, and a standing `CHANGES_REQUESTED` — so both can arrive while the head stands still, and the
head-moved check has nothing to object to. A Codex review built that sequence against the snapshot-only
version: read `merge-now`, reviewer replies without pushing, press. So each row is re-read once immediately
before ITS press (one small request per pressed row, no bodies) and `remoteJudgementSignals` is asked again
over what came back; one definition serves both paths so they cannot drift. A conversation that could not be
re-read blocks the press exactly as an unreadable head does — and so does one that came back SHORT, because
the signal a press has to see lives in whichever page GitHub declined to send: a hundred resolved threads and
a hundred-and-first opened by a reviewer reads as clean until `threadsTruncated` is asked about. Both flags
are already terminal evidence a dispatch may not conclude over; the write path owes the same answer. The
remaining signal needs a local merge rather than a request and is not re-measured here.

**The two residues, named rather than implied.** The COMMIT one is already closed and not by this verb:
`github enqueue` reads the head itself and passes it to `enqueuePullRequest` as `expectedHeadOid`, so GitHub
refuses a write whose head moved — the press-time head read buys a readable refusal and a press not spent,
never safety that was missing (`grep -n expectedHeadOid src/cli/commands/github/enqueueRun.ts`). The
CONVERSATION one is irreducible: the mutation takes an expected HEAD and nothing else, so a reply landing
between the re-read and the write cannot be refused atomically the way a moved commit can. What the re-read
does is shrink that window from the whole fleet read down to one request, and no path reaches a press
without it.

**`--press --json` emits ONE document.** `github enqueue` prints a readable verdict block of its own, and
under `--json` that block goes to the diagnostic channel instead of stdout so the document parses. The lines
are redirected, never dropped — a refusal still has to be readable.

## What the supervisor does with it

`--json` carries `dispatchable`: every `act` row except `needs-owner-judgment`, less any row whose press call
this run made and `github enqueue` accepted. `landing` sees only the exit code, so "accepted" covers both
"queued it" and "found it already queued" — and either way there is nothing to send a session for, which is
what the exclusion is about. Selected once, so no consumer re-derives which rows the owner asked to be carded, and so
one document never both reports a press and lists that row as work to spawn. **`--register` turns that array
into board rows and spawns nothing**, `merge-now` excluded: [landing-cadence.md](landing-cadence.md), also the
tick contract beside [sweep-contract.md](../../supervisor/reference/sweep-contract.md) step 7. What `HIGH`
means, and the ruling it sits in tension with: [react-now-groupings.md](../../supervisor/reference/react-now-groupings.md).
