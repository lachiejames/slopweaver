# Owner-ruled additions after the mining pass

Part of [The recurring-failure register](../recurring-failure-register.md).

- **`a-land-slower-than-the-base-cadence-cannot-land-unheld`** — measured across the fleet in one night, and it is a
  THROUGHPUT class rather than a correctness one, which is why nobody filed it while each session experienced it
  privately as bad luck. The full gate costs roughly 12 minutes on a load-starved machine and `main` was landing
  roughly hourly, so any land whose gate plus push exceeds the gap between merges loses the `base-moved` race and
  pays the whole gate again. **Three independent sessions took the merge hold within one hour giving the same
  reason in their own words** — a `dev` gate, a corpus sequencing phase, and an as-me render check — which is the
  evidence that it is structural rather than three unlucky nights. **The remedy is the native merge queue, not a
  hold**: a hold lane serialising the fleet measured idle 41% of a day behind parked holders. Neither `github
push` nor the creation gates `github stack push` runs refuses a `base-moved` head when the base's queue gates
  on real status-check contexts and the base is within sixteen commits — the queue tests the merged result on the
  tip, so the local lap is not what protects it ([the merge hold](../../skills/github/reference/merge-hold.md)). A
  gate lap slower than the base cadence lands unheld; the class name records the failure as measured.

Recorded here as they land, so the register stays the one place a class is looked up. Each names the doc
that owns the build, per the board's one-row rule.

- **`as-me-public-post-fragments-and-degrades`** — three anchored instances in one incident: the as-me lane
  fragmented a public TOP-LEVEL post into a four-message drip (the drip cap was tuned for thread replies),
  degraded an unresolvable mention to literal `@…` text instead of refusing, rendered literal asterisks in a
  thread post, and appended a correction message instead of editing. The owner deleted all five posts personally.
  Fix directions: channel context belongs in the door (a top-level public post is ONE card), a degrading mention
  is a REFUSAL, render-proof goes via a bot DM, and a correction is an edit or a delete-and-repost, never an
  appended message. Owned by the ready doc `as-me-public-posts-one-card-rendered-clean`. Kept SEPARATE from
  `voice-rules-run-late-and-only-on-one-lane`: that class is about which lanes the voice check covers, this
  one is about post SHAPE and mention degradation, and one tripwire would not catch both.
- **`parked-question-anchors-freeze-against-live-state`** — worth fixing immediately, with a measured instance. A
  run PAUSED on an owner question records that question once, and nothing re-verifies the anchors it names before
  a supervisor surfaces it. Measured: a journal question described a pull request as draft with one check still
  red and asked the owner to rule on that red check, while the owner had already CLOSED that pull request the day
  before. A supervisor session surfaced the frozen question to the owner without a live read first. Verified here
  by reading the journal question and then the live object, which returns `state: CLOSED` against a question that
  presents it as open and awaiting a decision. **Seam:** the path that surfaces a parked run's question
  re-reads every pull request, ticket or SHA the question names, and refuses or annotates when an anchor has
  moved. **Kept separate from `owner-facing-row-asserts-state-it-never-re-read`** on [this file](../recurring-failure-register.md)'s own dedupe
  test: one tripwire at question-surfacing would not catch a stale ranking row, and the ranking half was
  already fixed by a live-read-before-ranking change while question surfacing was not.
  Same family, different seam.

- **`waiter-reads-empty-as-cleared`** — measured live. A review waiter filtered on a bot's login,
  matched nothing, and reported the review CLEARED. It was not cleared. The query had simply failed to match,
  and an empty answer was taken for a passing one. Caught against the raw reviews endpoint before it cost a
  false green. **The general class is the fail-open, and it is the one worth gating**: a waiter, poll or
  freshness check must treat an unreadable or empty answer as a STOP, never as a pass. Silence is not
  evidence. Same family as the freshness-gate refusals and the sole-repo bare-ref surprise. **Seam:** any
  wait/poll helper whose exit condition is "the filtered set is empty" must distinguish _queried and found
  none_ from _query matched nothing because it was malformed_, and refuse on the second.
  **Second instance, same class, different mechanism** — reported by the session that measured
  it, and recorded as theirs rather than verified here (the named script is not on `acme-admin`'s current
  branch, and a repo-wide search for it timed out): the other repo's ship-watcher script was invoked positionally with a bare PR number
  where it wants a `--pr` flag, so it exited immediately having watched nothing, silently. Worth carrying
  because the first instance was a filter that matched nothing and this one is an ARGUMENT SHAPE that
  matched nothing. A gate written only against bad filters would miss it. The common property is the one to
  detect: the waiter never observed the thing it reported on.
- **`bot-login-suffix-differs-by-api-surface`** — the trigger for the class above, and worth its own entry
  because the obvious fix is wrong. The waiter compared against `coderabbitai`; the reporting session
  measured the REST reviews endpoint returning `coderabbitai[bot]`. **Checked here on the GraphQL path and it
  returns the login UNSUFFIXED** — reading a real reviewed pull request through `slopweaver github read`
  yields `coderabbitai`, `linear` and `nx-cloud` with no `[bot]` on any of them. So the rule is not "always
  append `[bot]`". The rule is that **the suffix depends on which API surface answered**, which is worse,
  because a fix copied from one path silently breaks the other. The REST half is the reporting session's
  measurement and is recorded as theirs; the GraphQL half was verified here.

- **Gold evidence for the two voice/as-me classes.** The owner APPROVED a one-card governance
  review ask, then deleted it and rewrote it personally as two lines — mentions, "pls review", the PR link
  with its full title, and one sentence saying what it is — cutting the measurement, the halves and the
  invite-pushback paragraph entirely, and linking it into the prior thread rather than restating context. An
  approved draft is not a liked one: the owner edited before people saw it.
  Two facts this fixes, and the first is the one that generalises: **the composer's benchmark is the owner's
  SENT corpus, not the owner's approvals** — an approval given under review is a weaker signal than what the
  owner actually ships, so any gate calibrated on approved drafts is
  calibrated on the wrong set. Second, narrower: a review ask has a default TWO-LINE shape with the detail
  left in the PR. Recorded as memory `review-ask-voice-two-lines-max`; the fixture lives with the as-me class
  doc. Wire it into whichever voice gate the ranked builds touch.

- **`refusal-recommends-a-key-shape-that-cannot-work`** — tier-1 verified twice. While the
  derived roster is heap-blocked, the mention door's refusal message lists "canonical person id" FIRST, but
  person ids do not resolve; only raw provider ids do, confirmed because the overrides file supplied
  the only working key while the derived roster supplied none. Cost: routine
  sends blocked or delayed. The class is general and worth stating that way: **a refusal message that
  recommends a key shape which cannot currently work is a confident lie at the exact moment of failure**, and
  it is worse than a bare refusal because it sends the reader down a path that cannot succeed. Related to the
  roster/heap classes rather than a duplicate of them — the heap blockage is the cause, the misleading
  refusal copy is the separate defect.

- **`pre-push-gate-runs-inside-the-open-transport`** — GATED by `pushAndVerify` in
  `src/admit/githubPush.ts`, which every push in this repo (`github push`, `stack push`/`adopt`/
  `sync`) goes through. `git push` opens the ssh transport to discover the remote's refs BEFORE it runs the
  `pre-push` hook and sends the pack afterwards; this repository's hook was once `yarn validate` at eight to ten
  minutes and is now `yarn validate:local` at 43.5 s, and GitHub resets the idle session first. Five failed
  pushes (`closed by remote host`, SIGPIPE) were fixed with client keepalives — which a later pair (`Connection
reset by peer`, then SIGPIPE, keepalives in place) proved insufficient. The verb runs the hook itself, with git's
  own argv and stdin and a clean `GIT_*` environment, before any connection exists, and pushes `--no-verify`
  only once that hook has RUN — a repository with no executable hook gets a plain push, so the flag never
  outlives its reason. That split is also why the hook-satisfied branch is the one that rots unnoticed:
  `hookSatisfiedPushArgs` once read position zero for the `push` subcommand, so the salvage push
  in `worktree prune` — which opens with git's own `-c core.hooksPath=/dev/null -c core.fsmonitor=false` — was
  REFUSED outright in every repository carrying an executable `.husky/_/pre-push`, and silently fine in every
  repository without one. It scans past git's global options and inserts `--no-verify` directly after the
  subcommand. **The lesson worth carrying: a keepalive is a bet on the other side's patience; the fix
  for "the connection outlives the work" is to do the work before opening the connection.**

- **`autolinker-resolves-a-cross-repo-number-into-the-wrong-repo`** — GATED in
  `src/outbound/linkify/bareRefs.ts` (`BareRefContext.attested`), reached from the pull-request, comment and
  briefing-page doors. A slopweaver pull request body cited several cross-repository pull requests as
  bare numbers, and the door linked them to unrelated objects
  in the target repository while the Proof cell read as verified; both format gates accepted it, and it was found
  and fixed by hand at queueing time. **The lesson is about where a rule's confidence comes from.** The
  sole-repo rule was not failing — a pull request's own repo is named by its form's target and is never
  ambiguous, so the rule had nothing to refuse and reported nothing wrong. A gate that can only ask "which
  repo" is silent on "could this number BE from that repo". The gate also weighs magnitude, against
  numbers the body itself proves exist (its own links, plus the pull request being updated), and refuses a
  bare number with more digits. **It is deliberately evidence-gated and one-directional** — a body attesting
  no number refuses nothing, and a small bare number on a large repo still resolves — so it narrows the
  blind spot rather than closing it, which is why it is written down rather than assumed away. The widened
  sole-repo alternative (refuse every bare ref once a body links two repos) was rejected on the evidence: it
  would have refused the hand-fixed body's own correct small numbers.

- **`an-answer-posted-off-the-answer-lane-is-invisible-to-every-answered-test`** — measured, and
  the owner saw it before the code did: an old ask was getting re-answered by the bot
  multiple times. The owner's DM ask was answered in-thread and corrected minutes later, and a fresh loop's boot
  recovery pass captured it as a dropped tag 34 hours
  afterwards and posted a THIRD reply into the same thread. **Both real answers were real** — they left rows in
  this install's own door ledger — but they had gone out through the `slopweaver slack post`/`reply` BOT-CARD
  lane rather than through `turn answer`, and that one fact silenced BOTH independent proofs at once: no
  `slopweaver_assistant_answer_v2` `askIdentity` on the wire for `already-answered` to match, and no
  `answered` row in `live/slack/asks.jsonl` for any of the five lifecycle exclusions to read. The ask's whole
  lifecycle log was empty until the pass that re-answered it wrote `captured`. **The class is not "the
  classifier was too strict"** — it is that a second outbound lane can produce a genuine answer while every
  test for "did we answer this" keys on artifacts only the FIRST lane emits, so the two proofs that look
  independent share one upstream dependency. **Narrowed** by `answered-in-thread`
  (`src/live/listen/recover.ts`), which reads the operator's own `cardChrome.metadataEventType` as weaker
  evidence inside the candidate's own stretch of the thread — bounded above by the next message that itself
  tags the bot, so two asks sharing a thread stay separate, and requiring this install's own authorship, so
  the owner's as-me token is not mistaken for it. **The residue is stated rather than discovered**: an answer
  hand-posted under the owner's OWN identity carries no Slopweaver metadata at all and is still invisible.
  The durable fix is upstream — the card lane should accept the ask it answers and append its own `answered`
  row — and it is a board row rather than part of the narrowing.
- **`public-ask-dispatched-with-no-live-progress-card`** — owner-ruled on the owner's own
  public `#dev-alerts` ask: a worker reacted with eyes emojis but no live progress card stood in the thread,
  which makes for a poor experience on the owner's end and should not be structurally possible. A worker
  reacted and ran subagents for seventeen minutes with
  nothing standing in the thread. **The mechanism, not the mistake:** capture's card post is best-effort and
  SWALLOWS its own failure, and the `checklist-posted` lifecycle append is guarded on the post having landed
  — so a failed post left the log going `captured` → `dispatched` with no card ref anywhere, and every
  main-flow card verb downstream then refused for want of one. Nothing in the dispatch path noticed, because
  a card was something capture was supposed to have done rather than something dispatch required. **What it
  produced next is the second half**, and it is why the class is about the ABSENCE of one shape rather than
  the failure of it: a card-less worker reached for a second, older progress surface still standing in the
  tree (`slack progress start|step|…`) and posted a different shape into the owner's thread. The owner's
  ruling was to DELETE every progress-card shape but one rather than deprecate them, so `src/outbound` offers
  a worker no second thing to reach for. **Fixed by making the card a required argument** of `turn
dispatch`'s tier execution (`src/cli/commands/turn/ensureCard.ts`): a dispatch proves a card — carried on
  the brief, recovered from the lifecycle log, or freshly posted — before a lease is minted or a brief is
  handed over, and REFUSES the whole dispatch when it cannot, so a card-less dispatch does not compile and a
  card-less worker is never started. `turn resume` refuses the worker half on the same ground.
  **The FRAME half was still open after that** and is closed by the same gate: a proved card wore
  `PENDING_ROUTE_STEPS` — `◦ Work out how to answer` — because `src/live/turn/turnBegin.ts`, the only thing
  that corrects the pre-routing placeholder, runs inside `turn run` and `turn run` is the INLINE path.
  Nothing on the dispatch path touched the card at all, so it stood on the placeholder until the worker's
  own `turn status`, and on that ask the call never came (zero stage rows in the card's progress log).
  `ensureLiveCard` ADVANCES the card it
  proved, on all three branches, to `dispatchedCardFrame` — the same per-stage shape every later tick
  writes — so the frame a reader sees at the first tick is the frame they see at every one after it. A
  refused advance is REPORTED on the dispatch's own line and never refuses the dispatch: the thread has a
  card either way, and trading "nobody investigates the ask" for a better-looking card is the wrong side.
- **`tooling-shipped-before-the-public-ask-was-answered`** — the same ask, the other half of what
  it cost. It was captured in the public `#dev-alerts` channel and dispatched to a `fresh-visible-session` about a
  minute later. The worker read the ask correctly and went straight at the engineering: over two hours later it had
  opened, pushed, self-reviewed and enqueued a pull request. The first word
  the channel heard from it was the answer — **two hours and thirty-eight minutes** after the
  ask, and twelve minutes AFTER the owner asked in front of the team what was happening, feeling
  embarrassed in public. **The class is not "the worker was slow" and not "the tool was the wrong
  call"** — the composer change was right, it landed, and three review rounds caught real defects in the
  answer that followed. It is that **a pull request is not an answer, and nothing enforced the order**: a
  colleague watching a public thread cannot see a branch, a card detail line or a session, so every minute
  of correct engineering before the first reply reads as silence. **Fixed on both sides of the worker.**
  The instruction reaches it at the start of its turn — `src/live/turn/briefGuidance.ts`'s
  `answerFirstBriefLines`, printed into `turn resume` for a `channel`-surface ask and nothing for a DM,
  because the public audience is the whole criterion. The teeth are on the ONE pull-request creation door —
  `src/cli/commands/github/answerFirstGate.ts` in `stackPushLocalGatesRefused`, refusing through the
  `answer-first` escape-hatch row when this session is the announced worker for an ask that still holds an
  unsuperseded dispatch on a channel surface. **Its blind spot is stated rather than discovered**: a worker
  that ran neither `turn resume` nor `turn status` never announced itself and is invisible to the gate,
  which is `AGENTS.md` rule 3's own shape — a block confirms you were wrong, its absence means nothing.
  Matching on the worker's `cwd` instead was weighed and refused: `askSessionPlan` boots a worker into the
  dispatcher's OWN checkout, so that criterion would read the loop itself as the worker.

## Verify, don't trust: the claim classes

`AGENTS.md` § How we work states the rule; these are the failures it names, each with the trigger that should
stop you. Three map onto classes already on this register and are cross-referenced rather than re-filed.

- **`blast-radius-claimed-from-a-passing-test`** — trigger: writing "scoped to X" or "minimal blast radius". A
  passing test proves the fix works, not how far it reaches; the claim is checked against the actual diff first.
- **`sweep-reported-done-without-a-residual-rescan`** — trigger: finishing a prune, cleanup, audit or migration.
  Re-scan and report the residual count, ideally zero; "done" without the re-scan is an unverified claim.
- **`claim-corrected-in-a-reply-not-in-the-artifact`** — trigger: a figure found wrong in a body already
  published. A comment under a body still asserting it leaves the wrong number as the durable copy. Edit the
  artifact, then re-scan: that re-scan was once the only thing that caught a second ticket still
  carrying a retracted figure, beside a contradicting claim merged days earlier.
- **`claim-fans-out-before-it-is-verified`** — trigger: a claim about to be written a SECOND time, whether
  inherited from a handover, audit or planning doc or written by you. An audit's "proven twice
  on real staging PRs" once shipped into a PR body and a skill while both PRs had closed unmerged two weeks earlier;
  and "availability cannot be served locally" reached a PR body, a ticket, a second PR and two board
  docs as an infrastructure limit, when it was a seed artifact nobody had booted. Verify before the second
  copy, and when one copy turns out wrong, sweep every copy in the same sitting. **The dangerous copy is the
  one that WAS true**: a claim checked once and quietly outdated by moving work keeps its confident tone, so
  when the thing it describes changes, the record is stale however honest it was when written. The doc-premise
  half overlaps `run-executes-a-doc-whose-premises-the-repo-contradicts` ([refuted as a gate](refuted-and-seed-candidates.md)).
- **`bulk-delete-by-prefix-takes-a-named-entry`** — trigger: deleting shared or test resources by pattern.
  Cross-check the fixed names in committed config and exempt them first; a committed fixture usually shares
  the disposable prefix.
- **Look at the rendered result** before reporting any create or post a human will see, above all one
  carrying an image: API success is not a correct render. Filed as
  `published-doc-shipped-without-opening-it-rendered` ([refuted as a gate](refuted-and-seed-candidates.md)).
- **Distrust a wrapper's own summary line**: several shell constructs here fail silently and manufacture
  false greens, so verify by re-reading the state. Filed as the survivor
  `verification-run-in-a-shape-whose-green-means-nothing` ([survivors](survivors.md)).
