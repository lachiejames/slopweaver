# The reviewer packet, and what the door checks

What CODE puts in front of the reviewer, what the outbound door verifies about the answer independently of
any verdict, and the one thing a dispatched turn does differently when it posts. The rule these serve — no
verdict, no send, and the composing session never briefs its own reviewer — is in [reviewer.md](reviewer.md).

## What the packet carries — exactly these, and nothing else

0. **which ROUND this is**, and what the last round left unresolved — unnumbered in the packet, because it is
   the terms of this round rather than another piece of evidence about the answer. See "Rounds" above.
   Beside it, also unnumbered: **the clock** — when this round opened, how long the ask has already spent in
   review, and the measured round cost (5.7–23.2 min a round, median 12, review 49% of
   tag-to-answer on public turns) with no deadline, which is unruled — and **how to verify**: enumerate the
   claims, then issue every independent read in ONE parallel batch, then classify. `turn review` refuses to
   send the pickup for a written packet missing the clock (`src/live/turn/reviewThroughput.ts`).
1. **what the question literally asked to be HANDED**, and the instruction to check it FIRST. Measured:
   a deploy + backtest + screenshots ask ran SIX review rounds over two hours and shipped
   without a clickable link to either monitor it had deployed — ids and screenshots, no URL — while every
   one of those rounds rigorously verified a gate evaluation, a before/after and an inconclusive analysis
   nobody had asked for. So the packet leads with the artifacts, makes `the answer delivers every artifact
the question asked for` a STANDING high-impact claim, and says both halves out loud: a missing artifact
   is `broken` and outranks every fine-detail nit, and analysis the question never requested is not grounds
   for `broken` or `incomplete` at all. The bar on what IS delivered does not move; the order does.
   Two artifact classes are decidable from the question alone (`src/admit/requestedDeliverables.ts`) and
   the send door refuses an answer missing one, so the reviewer's job there is whether the link points at
   the right thing, not whether a link exists.
2. the **question** as asked, with the ask's own thread — permalink when known, channel and ts otherwise.
   That conversation is ALWAYS in scope as evidence: measured, a reviewer pointed only at
   provider records marked a claim `unverifiable` whose proof was a message in the ask's own thread, and the
   packet says never to mark one `unverifiable` without having read the thread.
3. the **composed answer**, verbatim — the exact JSON the digest was computed over
4. its **digest**, in its own fenced block — the reviewer binds its verdict to these bytes
5. the **live-read plan**: which sanctioned reads the decision named, and the decision's truth mode
6. the answer's own **grounding** — what it says it read, found empty, and could not see
7. its **citations**, in full
8. a POINTER to any **applicable owner directives** in the brief, never their text
9. the **voice rules, NAMED one per line** from the brief's private profile — never summarised as "check
   voice". Measured: two reviewers in a row returned `clean` on answers whose voice was never
   checked against the profile, because their briefs pointed at a file instead of naming the rules. The
   packet makes voice one more material claim to classify, binding on EVERY string that renders — the lead,
   the index, the body, AND the grounding's evidence labels and `couldNotSee` text, which render in the
   Details fold (five of eight violations in one posted answer were in the evidence trail) — and consistent
   with the bot's earlier messages in the same thread. **The claim is not the whole record**: the
   verdict carries a `voice` FIELD as well (`rulesChecked`, `pathsChecked`, `violations` as `{rule, path}`),
   because a reviewer that read every rule and one that wrote the claim without opening a string produced
   identical verdicts while the claim was all there was. The door refuses a verdict silent there —
   `ANSWER_VOICE_UNCHECKED` — rather than reading silence as a pass, and refuses a recorded violation as
   `ANSWER_VOICE_BROKEN`. Both are `warn`s with `answer.quality:v1`; no voice rule hard-blocks. A violation names the rule and the field, never the offending words — the door ledger holds
   every finding summary and is not a copy of what the bot has said.

**Not the worker's transcript.** It would anchor the reviewer on the author's reasoning, which is the exact
thing a second agent exists to break — and the small context is what lets the reviewer run on a good model.

The packet asks for a `ReviewVerdict`: every material claim classified `supported`/`unsupported`/
`unverifiable` with its impact `high`/`low`, evidence named for anything supported, and an outcome of
`clean`/`broken`/`incomplete`. No confidence percentage — a self-calculated one "is always misleading".
Two claims are STANDING in every verdict, both high-impact: the deliverable claim (item 1, classified
first) and a supersession claim — `the thread has not already answered or contradicted this` — for which the
reviewer re-reads the thread's tail at review time. The voice claim (item 9) is a material high-impact claim
in every verdict and is NOT standing — the packet text is authoritative on the count, since a carry filter
holding the superset while this file, the late-round rider and the packet's own verdict section disagreed was
removing 123 of the 238 otherwise-carryable claims a week on the voice phrase alone. Measured: an answer led with "nobody wrote a reason down" three
messages below the tagged human writing the reason down; the reviewer NAMED that contradiction and made it
fixable, which is why the claim is standing. Distinct from item 2: that verifies the answer's claims against
the thread, this asks whether the thread has made the answer moot or wrong.

**Supersession is judged as of the REVIEWER's own read, and never later.** The window after it belongs to the
door, which computes its own delta between the point the answer read up to (`turn answer --read-through`) and
the instant of the send: a delta somebody has read and cleared (`--delta-cleared`) rides as a one-line
freshness note on the answer, and only a message that TOUCHES a named claim comes back as a round, narrowed
to that claim. Marking the claim `unsupported` because the thread has moved on since your read, rather than
because it CONTRADICTS the answer, is what cost a release incident
(`C0SYN000002/1789433376.265259`) five rounds and 156 minutes on a thread producing a message a minute — the
owner had to tell a colleague in public that it was unclear how long a final answer would take.

Every claim also carries **`restsOn`**, which only the reviewer can know: `answer` when the claim is settled
by the answer's own bytes and by sources that cannot move behind them (an internal contradiction, a count
against a table, a link's shape, a rule about the composed text), `live` when it rests on anything that can
change while the answer does not (provider state, the thread, what a URL serves, what a file at a path
contains). Unsure is `live`, and absent means `live` too, so a verdict written against an older packet stays
readable and simply earns no reuse.

It is not bookkeeping. A later round CARRIES an `answer` claim with its evidence as SETTLED instead of
re-deriving it, and never carries a `live` one that way — because an unchanged answer is not an unchanged
world, and an answer saying production is healthy can be byte-identical an hour after it stopped being true.
Marking a live claim `answer` is how a false claim reaches the thread. Measured: 93% of
every re-review round re-covered ground the previous round had already settled, which is what this field
exists to stop, and a blunter gate that skipped it would have had to disable reuse on 100% of the rounds that
actually ran.

**A `live` claim carries as a RE-READ, and only when its read was recorded.** On every `live` claim marked
`supported` the reviewer also writes **`readCommand`** — the exact verb, query or URL it ran, as it ran it —
and **`readAtIso`**, the instant. Both or neither: the verdict is refused with one alone. The next round is
handed the claim, the previous evidence, the command and the instant, runs the command NOW, classifies what
it sees, and writes its own read fields — never the previous instant. Measured with the settled
carry shipped: 1,501 of 1,913 claims rested on live state, the median verdict settled seven high-impact live
claims, and the next round derived every one again from nothing — a reviewer classified 15.06 claims a round
and was handed 0.18. Prose in `evidence` naming the read is not enough; nothing can re-run prose.

A carried claim reaches the next packet AFTER the answer and the evidence, never in the preamble — a reviewer
handed prior conclusions before it has read the answer is being anchored. A settled claim arrives as evidence
to inspect alongside a code-computed list of which answer paths moved since; a re-read arrives as a command
to run; overturning either is a normal outcome. The two standing claims above are never carried, whatever
their `restsOn` says. A round that opens on a verdict which settled at least one high-impact LIVE claim
and carries none of them as a re-read — no read recorded — writes a `loop-breakage` row naming the count,
so the starvation is a ledger line rather than a re-measurement (`src/live/turn/reviewRounds.ts`).

**Every round two carries the change list, and says the round's work is there** — never only inside the
settled block, which 107 of 127 measured verdicts left empty, so a re-review re-derived the whole
answer. `## Where this round's work is` names every moved path whenever
the previous verdict bound a digest: claims a changed path expresses or qualifies, the carried list, the
standing claims and the re-reads are verified from source; an answer-resting claim on unchanged paths may
be classified by naming the previous round; a live one is always re-read. No sound comparison, or the root
moved, and the round is a FULL review.

**No reviewer round follows a CLEAN one.** `turn review` refuses to boot one, prints the code diff of the
two answer files and the path of the answer the clean verdict cleared, and says to post that
(`src/cli/commands/turn/reviewAfterClean.ts`). Measured on `C0SYN000005/1789443736.519609`:
round 1 clean with two low nits, the answer edited, round 2 booted to say clean again. The hatch
`SLOPWEAVER_ALLOW_REVIEW_AFTER_CLEAN=1` is for a low claim that is materially wrong, a door refusal only an
edit fixes, or a thread that moved — never for polish.

**The worker is handed the same standing claims before round 1, never the other way round.** `turn resume
--answer` and the inline pre-flight print a BEFORE REVIEW ROUND 1 checklist rendered from the constants this
packet renders (`src/live/turn/reviewObligations.ts`). Nothing the worker concludes reaches the packet. The
one part code can check, an unread human message in the thread, is checked at round-1 open
([worker-contract.md](worker-contract.md), step 2).

## What the door checks about the answer itself

`grounding.provenance.model` must read exactly what **your own `turn resume --dispatch <id>` printed on its
`PROVENANCE:` line** — for a dispatched turn that names the worker and its workspace, e.g.
`"the dispatched worker in workspace:218 (Claude Code, in-turn)"`, never the supervisor. A turn this session
composed inline is `"the supervisor session (Claude Code, in-turn)"` (or its Codex equivalent). Either way
`--model` overrides it when something else actually produced the answer. Copy the line rather than typing a
label from memory: the door compares strings, and a mismatch is only caught at `turn answer` — after the
review has already bound its digest to the old bytes, so it costs a whole review cycle.

`grounding.kind` states what **actually** produced the answer — fill it honestly, not necessarily the tier
you judged (you may overrule it; say so in `lead`/`body` when you do). A `verb` grounding's capability must
be one your OWN decision named in `needs`; an `unreachable` grounding's surface must be one `turn brief`
listed as unavailable, or one your decision named — `turn answer` checks both, before anything reaches
Slack, and refuses the whole send on a mismatch rather than a silent correction. A citation chip in `body`
(`{"type":"citation","citationId":"1"}`) must resolve to a definition in `citations`, and every definition
must be cited by at least one chip, or the schema itself refuses it before anything reaches Slack. A `[n]`
typed as literal text is converted into the chip it names; one naming nothing, and one in the plain-string
`lead`, are refused. Labels are renumbered into reading order, so review what a marker POINTS at, not the
digit the composer wrote.

## A `fresh-visible-session` turn posts differently

**The worker posts.** Its workspace runs `turn resume --dispatch <id>` to load the brief and decision,
composes and validates its own answer (`turn resume --dispatch <id> --answer <path>` — the READY marker is its
validation report, not the end of its work), opens its reviewer with `turn review --dispatch <id> --answer
<path>`, waits bounded with `--poll --wait`, and then runs `turn answer --dispatch <id> --verdict <path>` itself, from
inside its own workspace — the same door, the same schema, the same refusals; its workspace closes once the
answer lands. This loop never carries a worker's answer through the door except in the one stalled case
`--sweep` names (`ready and unposted for Nm`, a verdict already on disk), and never an unreviewed one.

Screenshots or diagrams go in `images` as absolute file paths, as many as the evidence earns; `slopweaver browser shot` is
what captures, crops and annotates one. **Carrying them is not the same as expecting them.** The
composing session's own pre-flight defaults to attaching a shot when the evidence is visual,
and section 1b carries the ceiling that keeps that a default rather than a gate — a screenshot that is NOT
THERE is a `low`-impact note, never `broken`, never `incomplete`, never another round
(`src/live/turn/visualEvidenceGuidance.ts`).

Section 1c is the other half and it is a CHECK, not a ceiling: every picture the answer DOES attach is
listed with its digest and pixel size, the reviewer opens each one, and the verdict carries an
`imageObservations` entry per attachment saying what was visible, whether the target had rendered, whether
it reads at preview size and whether the context survived the crop. The door matches path AND digest
together against the bytes it is about to upload, so a picture swapped at a reviewed path is `stale` rather
than covered — the hole the answer digest cannot see, since `images` are path strings. An observation
recorded UNFIT is written to the image-record store before the refusal returns and is terminal for those
bytes; a coverage gap is a self-correctable warning. `src/admit/imageObservationCoverage.ts` and
`src/live/turn/reviewImageSection.ts`.

The send posts a working message, advances its checklist in place, then sends the reply as its own message,
wrapped in the same full chrome every bot message carries: the violet accent bar, the `:robot_face:`
author row, dividers above and below the content, and the `*Details*` label — the SAME chrome the operator's
own card carries, reused directly via `renderChromeBlocks` rather than by calling the card's own renderer,
because the owner wants every bot message reading like the operator card, not a stripped-down variant.

The reply replaces the working message rather than doubling it — one message in the thread, not two:
`renderUpdateCard` itself is pure (it only builds blocks; the caller
posts), so nothing about sharing its chrome sub-renderer introduces a second send. If you ever do see the
reply arrive twice, that is a genuine regression in the working-message/answer hand-off (`./run.ts`'s
delete-then-post ordering) — stop and report it rather than assuming it is the chrome.
