# The worker contract, and a rapid-tag burst

What a dispatched `fresh-visible-session` worker owns end to end, and how a rapid-tag burst is judged. Both
are read by the LISTENER: the loop dispatches and then reads the next line.

## The worker contract — what a dispatched session owns

The worker's pickup line and `turn resume --dispatch <id>` hand it this whole chain, in order, and it runs every
step ITSELF from inside its own workspace — nobody in this loop posts for it:

0. **Start the card's clock, before investigating anything.** `turn resume` prints it as step 0a with this
   brief and home already on it: `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn watch --brief <path> &`,
   backgrounded from the worker's OWN shell with a bare `&` — never `nohup`, never `setsid`, never
   `disown`, which buy nothing. It is **not** a child of the worker session: MEASURED, a backgrounded job from an agent tool-call shell has ppid 1 by the time the call returns. It reaps
   itself once it is orphaned AND the worker has stopped making tool calls — never while the turn is
   blocked on the owner — so there is nothing for the worker to stop. Step 0b is the plan and the stages
   (`turn status --plan`, then `--status … --step <n>`), and the two are not alternatives: the ticker moves
   the clock, the stages carry the findings. A worker inheriting a turn re-plans with `--plan` when the shape
   changed; the card shows the handover and the re-plan as phases of its loop. [live-card.md](live-card.md) has both halves and the floor under them.
1. **Research and draft.** Read the live thread (`slack read-thread` — investigation, never grounding),
   investigate with the whole verb surface (`skills/loop-bot/SKILL.md` applies unchanged), write the answer
   JSON, and validate it: `turn resume --dispatch <id> --answer <path>` — the READY marker this prints is its
   VALIDATION report, not the end of its work; a refusal is not terminal, fix and re-run ([why](turn-mechanics.md#a-grounding-id-refusal-is-not-terminal)).
   Above the marker it prints **BEFORE REVIEW ROUND 1**: the reviewer's two standing claims and its read-pair
   duty, from the same constants the packet renders (`src/live/turn/reviewObligations.ts`). Every first round
   on record broke on one of them, 7 of 7; run all three on the draft before step 2.
2. **Independent review, fail closed.** `turn review --dispatch <id> --answer <path> --read-through <ts>` opens the reviewer — a
   second visible cmux session, pinned to a model — and hands it a packet CODE composed from the answer's own
   bytes. **The worker never writes a word the reviewer reads**, which is what keeps the review independent
   when the worker is the one pressing the button; [reviewer.md](reviewer.md) has the
   rule. It waits with ONE call, `turn review --dispatch <id> --poll --wait --timeout-seconds 1200`, backgrounded
   (exit 4 means still working: it gives up and reports failure) — never a hand-rolled `sleep`/`tail` loop
   spending a turn per tick; the same rule covers
   watching a PR's own CI, via `github checks --wait`. No verdict, no send.

   **From the moment it opens a review the answer is FROZEN, and the review is what holds the turn's clock.**
   Re-running step 1 over bytes that would discard a verdict the door would accept as it stands is REFUSED
   until `--edit-reason "<why>"` says why, and the reason is journalled — a rewrite to tidy a `low`-impact
   reviewer note costs a whole round, which is exactly how one turn ran out of lease with two
   sendable verdicts behind it. A `broken` verdict, or an unresolved `high`-impact claim, needs no reason at
   all: that is the fix-and-re-review path the verdict exists to open. Meanwhile a reviewer mid-verdict, or a
   clean verdict bound to the bytes in hand, HOLDS the lease (`src/live/turn/leaseJudgement.ts`,
   [sweep.md](sweep.md)) — so a converging review cannot be lost to the clock, and the rewrite that makes a
   clean verdict stale is exactly what hands the clock back.

   **Round 1 does not open over a thread the draft has not read.** Before it
   boots the first reviewer, `turn review` re-reads the ask's thread live and refuses while a human message
   newer than `--read-through` is unread: the ask's own ts when nothing followed it. A failed read refuses too,
   because a check reported as run when it was not is the worse lie. Read the listed messages: one that
   touches a claim means fix the draft and re-run with a newer `--read-through`; one that does not means
   re-run with `--delta-cleared` (hatch row `review-thread-delta`). Later rounds are not gated, because their
   reviewer re-reads the tail itself (`src/cli/commands/turn/reviewThreadPreflight.ts`). The inline loop's
   `turn review --brief` takes the same flags.

3. **The door.** `turn answer --dispatch <id> --verdict <path>` — the same door, the same schema, the same
   refusals as any answer; the worker's own workspace closes once the FINAL answer lands. A first answer
   whose form declares `followThrough` (a plan posted before a build, [raising-a-pr.md](../../loop-bot/reference/raising-a-pr.md))
   writes `first-answered` instead: only its reviewer is reaped, and the workspace, the dispatch and the card
   stay up until the final answer or a `--failed` report.
4. **The terminal report.** `answered` is written by the door. A worker that cannot answer says so —
   `turn resume --dispatch <id> --failed "<why>"` — and stops. That FAILED report is the one terminal this loop
   still finalises: `--sweep` reads it, marks the card "this turn failed — <the worker's reason>" and converges the
   reaction.

**A budget warn is a fact to plan against, never an order.** `turn resume` prints the dispatch's warn mark
and `turn status` prints any `BUDGET WARN` the loop's sweep raised (the clock crossing the mark, or the loop's
one-sentence observation) — [sweep.md](sweep.md#the-budget-warn--you-are-the-witness-on-this-pass-and-nobody-else-is).
Weigh it at the next planning beat; how the turn ends stays the worker's call.

The admit rules, the indicator contract and the answer-review gate are those of any turn; only the executor
differs. Two consequences worth stating: **voice rules bind every string that renders** — the worker
composes the grounding's evidence labels and `couldNotSee` text under the same profile as the lead, and the
reviewer's packet names each rule as a claim to classify (a rule pointed at is a rule not checked); and **a
follow-up on an ask that already has a terminal is a RE-DISPATCH**, a fresh `turn dispatch` opening a new
generation for that ask — never this loop composing the follow-up itself, and never the old worker resurrected.
`session close-done` judges that new generation on its own: a terminal recorded BEFORE the ask's latest
dispatch is the earlier generation's ending, never this one's, so it reaps nothing — a lease expiry later
in that generation included.

### A rapid-tag burst is JUDGED, tag by tag — never parked, never doubled

Someone tagging the bot several times in quick succession is one person bursting the bot, not N independent
questions. Every one of those tags still arrives on your stream as an ordinary line, and each gets its own
judgement: answer the first, then judge each later one on what it actually is.

**The brief tells you what is already running for that person.** When the asker has other asks in flight,
their brief carries an `ALREADY IN FLIGHT FOR THIS ASKER` section naming each one and its state. Three shapes
follow from it, and the choice is yours:

- The follow-up only adds to the ask already running — fold it in, and let that turn's answer cover both.
- It is a genuinely separate question — answer it as its own turn.
- It needs nothing at all ("actually ignore that", a correction of a typo, the bot's own draft echoed back) —
  judge `no-response` and set `"exclude": true` on the decision, which writes it to the permanent exclusion
  registry with your rationale as the reason, so it never comes up again.

**Never start a second worker on a thread one is already answering.** Measured: a follow-up
admitted beside a live worker produced a second answer that said "the first attempt never got going, nothing
ran", which was false. The in-flight section exists so that mistake is visible before you dispatch, not after.

**A later tag is never parked in a queue**: a queue of parked tags was measured
holding 34 behind asks that had already ended, nothing ever going to release them, one a real question the
owner had asked the day before. An `:hourglass_flowing_sand:` on an old message comes off at the next
transition on that ask.

Step 2 above is the whole judgement call — see [Composing the RoutingDecision](routing-judgement.md)
for exactly what a compliant decision must contain.
