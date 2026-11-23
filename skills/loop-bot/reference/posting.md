# Posting the answer — why `turn answer`, and never `slack post`

The command-family distinction, the brief path you must not overwrite, and the profile and owner-directive
guidance a brief carries into the composition. The rule — one answer per turn, through the same brief the
judgement used — is in [SKILL.md](../SKILL.md).

### A CLEAN verdict means POST — the low-impact residue is advisory

**Clean is enough for POLISH.** A clean verdict still lists claims it could not mark `supported`; by
construction those are all LOW impact, because a high-impact one is what makes a verdict `broken`. Tidying
them is not thoroughness and does not buy another round.

**The exception is the one that matters: a remaining unsupported claim that is materially WRONG is not
polish.** If you read one and it is false, the reviewer misjudged its impact — fix it and take the round.
The rule ends revision loops, not judgement.

**Revising after a clean verdict is self-defeating, not merely slow.** A verdict binds an answer DIGEST, so
the moment you edit the answer you have VOIDED the verdict that cleared it. A worker polishing after clean
cannot converge — every improvement destroys its own permission to post — and `turn review` REFUSES to
open the next round, printing the code diff of the two answer files and the path of the answer the clean
verdict cleared (`src/cli/commands/turn/reviewAfterClean.ts`, hatch `SLOPWEAVER_ALLOW_REVIEW_AFTER_CLEAN=1`
for the exception below). Post that file.

MEASURED in the owner's own DM: one ask reached review round **six** over three and a half
hours holding a clean verdict since round 3, and never posted. Its worker was treating the low-impact
residue as work to do, and reasoned its way to a stopping rule only at round 6 — three consecutive cleans
are enough signal the substance is sound — a rule it had to invent for itself.
`src/live/turn/reviewRounds.ts`'s `REVIEW_ROUND_CAP` did not fail: it caps what a late round may be ABOUT
and it worked, outcomes went clean at round 3 and stayed clean. It measures whether the ANSWER is
acceptable; nothing measured whether the worker keeps volunteering new ones.

**What this trades, said plainly: it does lower a bar.** The exact counterexample: a reviewer that lists
"the backup retention period is 30 days" as unsupported but LOW impact, on an answer where 7 is the truth,
returns `clean`. The door's `claimFindings` blocks only on `high`, and the answer form checks shape and
citations rather than whether a statement is true — so nothing else catches it. This rule rests on the
reviewer's IMPACT CLASSIFICATION being right, and a misclassification ships where a round might have
caught it.

That is accepted deliberately, against a measured cost on the other side: six rounds and three and a half
hours on one ask, twice in one day. It is also why the rule is "enough for polish" rather than "enough",
and why the paragraph above tells you to take the round when a low-impact claim is actually wrong.

What does NOT change: a `broken` verdict still opens the fix-and-re-review path, a high-impact unresolved
claim still refuses the send at the door, and correctness of what was asked for stays strict. The owner's
correctness-over-speed ruling stands — this removes laps that bought nothing, not scrutiny.

### Correctness over speed has a latency ceiling

A teammate's ask once ran five review rounds over two hours and the supervisor posted
the reviewed answer by hand: correctness over speed is still the mission, but what the owner saw was **slow AND
lower quality**, not a trade between them. A public silence costs trust faster than a caveated answer does,
and a review loop that does not end delivers neither. So past about three review rounds, or about an hour, on
a live teammate's thread, the next act is an answer with its boundary stated — or a recorded ending — never
another round. `REVIEW_ROUND_CAP` (`src/live/turn/reviewRounds.ts`) narrows what a late round may be about
and is deliberately not a stop; this ceiling is yours to keep. When a turn has already overrun it, a session
that steps in and posts the reviewed answer is doing the right thing: jumping in and answering on a teammate's behalf beats leaving them in the dark.

### A posted answer deletes every card its ask posted before it — never delete them by hand

**Standing rule:** once a real answer posts, every card an earlier turn on the SAME ask left
in the thread goes — its checklist, its failure or held-for-review notice, its blocked-on-human tag. The owner's
test is a reader's: is anything from the bot in that thread irrelevant now. `turn answer` does it on the send path
(`src/live/turn/earlierCards.ts`, read from the completion ledger and the ask log), so there is nothing for
you to remember and nothing to delete afterwards.

**An earlier ANSWER is never reaped as furniture — it comes down only when a correction SUPERSEDES it**, by
naming its `ts` in the answer form's `supersedes` and only with a reviewer's own warrant on the verdict. That
is the section directly below; the reap path above cannot touch an answer at all.

MEASURED (`fixtures/replay/answer-under-its-own-failure-cards-7sep`): a refused turn's checklist
and failure card stood above the later answer for 22 hours. A card that would not delete is printed by
`turn answer` as a `reap` line naming its channel and ts — that line, and only that, is a hand-delete through
`slopweaver slack delete`. A released held answer (`queue release`) does not reap its held notice yet.

### A correction deletes the answer it replaces — declared by you, warranted by the reviewer

**When a follow-up replaces what an earlier answer of yours said,** the earlier one goes, so a read-back of
the thread holds only what stands, with no noise or transient clutter. The shape to copy: a link line, a one-line correction, three
short bullets, the details folded.

- **You DECLARE, you do not delete.** Put the earlier answer's `ts` in the answer form's `supersedes` when
  your answer replaces a CENTRAL claim of it. A purely additive follow-up — more detail, a further finding,
  a second question answered — declares nothing and deletes nothing.
- **The reviewer WARRANTS it, separately.** The verdict carries its own `supersession` judgement, and a
  declaration with no warrant deletes nothing and says so in the turn's completion. Two declarations, because
  the act is irreversible and the session that wrote the correction is not the one that authorises removing
  the thing it replaces.
- **Never write "the previous answer was deleted."** The correction stands on its own: the reader sees one
  answer, and prose narrating a deletion describes a message they cannot see.
- **Only this installation's own answers, in the same thread.** Every other case — another bot's message, a
  message in another thread, an answer this install has no completion row for — is refused and journalled
  with the code that refused it (`slopweaver` reads the journal; nothing about it is a card for the owner).

Replay: `fixtures/replay/correction-supersedes-answer-22sep`.

### A claim found wrong on a LATER read is corrected in place — never deleted, never a bare reply

When newer evidence — a reply the recovery sweep surfaced, a later investigation — shows a claim you posted is
wrong and you are NOT posting a replacement answer, edit the original: `slopweaver slack correct --wrong "<exact
words>" --correction "<line>"` strikes it under a bold **Correction:** line, riding the original send's approval. A
same-order figure goes out without the owner; an order of magnitude is held for a Queue question first. It refuses `CLAIM_UNSTRIKEABLE` when the claim also shows where no strike reaches (a header, a context
line, an alt text), and it reports landed only when the read-back shows the strike under this exact line. **The
line between this and the section above:** a replacement ANSWER in the thread supersedes; a
correction with no replacement edits in place. Detail: [read-before-and-after](../../slack/reference/read-before-and-after.md).
A posted WITNESS reply is corrected with `witness revise <id>` instead, the same strike aimed at the journalled
reply and recorded once ([witness](../../witness/SKILL.md)); `slack correct` on it would leave the journal
saying the witness still stands.

### In a team thread the bot raises it once, then steps back

When the bot raises an issue in a team's thread it says it once, corrects itself at most once, and then lets the
team run at their own pace. That one self-correction is an EDIT of its own post or a declared supersession (above)
that removes the original, never a second visible post. A later human message in that thread is read, never
answered, unless it tags the bot or asks it something, and "should the bot reply" is never a card. The bot is not too noisy: it raises the issue without
dominating the conversation, stepping back and letting the team work at their own pace. Whether the bot's reply
there wears the violet answer banner or reads like a team member's is left open: keep the current choice per post and never raise it as a ruling.

### Posting goes through the SAME brief + `turn answer`, never `slack post`

**The bot's own reply does not go through `slack post`.** The turn's answer carries the SAME full chrome
(author row, dividers, `*Details*` label) as the operator card, by reusing `renderChromeBlocks` directly
rather than by calling `renderUpdateCard` itself. The reason is that `slack post` is a SEPARATE command family
with its own metadata identity (`slack-card-v1`, reserved for a human operator's own `slack post`) — using it
here would be a second, unnecessary send path for a reply `turn answer` already owns. The two renderers'
distinct `event_type`s let a later edit or sweep tell an operator card apart from a bot answer, though both
look the same on screen.

There is no double-post risk baked into the shared rendering code: `renderUpdateCard` is pure (no state
mutation, no Slack call of its own — the caller posts), so reusing its chrome sub-renderer cannot pull in a
second send. The risk this section guards against is purely a command-choice mistake — reaching for
`slack post` instead of `turn answer` — not a rendering hazard.

With the spinner already cleared (previous section), post it the same way `/slopweaver:loop` does — compose
the answer from what step 2's investigation found, then `turn dispatch` → `turn answer`, reusing the EXACT
brief path `turn brief` printed in step 2. **Do not run `turn brief` a second time here** — the file at that
path is what `turn dispatch`/`turn answer` read, and re-running `turn brief` for the same ask overwrites it:
a measured data-loss defect, so a second call REFUSES unless `--force` is passed, precisely
so a session reaching for it here is stopped rather than clobbering the brief step 2 already wrote. If you
only need to re-check what a capability covers, use the read-only door instead:
`turn brief --contracts --text "<question>"`, which writes nothing.

`turn brief` prints what this context can and cannot reach; it decides nothing for you. You already
investigated with the full toolset in step 2, so compose the `RoutingDecision` from that — most turns here
judge `respond`/`inline` (you already have everything you need) or `respond`/`read-only-subagent` (dispatch a
bounded native subagent for one more leaf, then feed its evidence back). `respond`/`fresh-visible-session` is
admissible too, on either host, for the rare turn that genuinely needs a real, watched workspace — the worker
posts its own answer and the supervisor tick's `turn dispatch --sweep` reconciles whatever it leaves, per the
dispatch-and-wake procedure below. Then:

When the brief says a private judgement/voice profile is loaded, read `routingInput.profile` from that
brief: apply `routing.*` to the decision and `voice.*` to the answer. Never quote the private profile. Apply
the bounded recent pain-point list too, when printed; those are exact composition misses to avoid repeating.
`turn resume` prints the same guidance inside a fresh visible session, so the voice contract survives the
workspace hand-off.

When it says current owner directives are loaded, read `routingInput.ownerDirectives` too. Apply each matching
directive to action and authored voice where relevant; it overrides conflicting mined-profile guidance because
it records a newer explicit owner decision. Never quote the private directive. `turn resume` carries these
same frozen rulings into a fresh visible session.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn dispatch --brief <the brief path> --decision <your decision file>
```

Follow whatever `turn dispatch` prints next for the tier you judged. See `/slopweaver:loop`'s **"Composing
the RoutingDecision"** and **"Then post exactly one answer"** sections for the exact decision/answer JSON
shapes, the citation-chip contract, the `images` field (already-produced paths only, as many as the evidence earns, and
attached by DEFAULT when the proof is a picture — [visual-evidence.md](visual-evidence.md)), and what
a mismatched grounding claim does — refuses the whole send, never a silent correction. The same `turn answer`
command closes it out:

### A door refusal on the SEND is not the turn failing — you still hold the answer

A `turn answer` the admit door refuses on **warn-tier findings alone** exits `3` printing the refusal, and
that is the whole ending: nothing posts to the thread, no failure card, no terminal lifecycle event, no
completion row, and the dispatch record stays alive so `turn answer --dispatch <id>` still resolves. The
`:eyes:`, the checklist and the native indicator all stay up on purpose — only the status re-assert timer
stops, because the turn genuinely has not ended and the same worker is still holding the answer. **Fix what
the refusal named and offer it again.**

**Two refusals are NOT this and still end the turn.** A `hold` is the obvious one — nothing about it gets
better on a second attempt. The other is a WITHHOLD (`withhold.reply`), which is itself warn-tier and is told
apart by its finding CODE before severity is ever asked: a withheld draft is the feature working, so it files
the draft, posts the notice and ends the dispatch.

MEASURED on `C0SYN000001/1790048248.995219`: finalising that refusal as `failed` superseded
the dispatch — `turn resume --dispatch` and `turn answer --dispatch` both then
answered "no dispatch record found" — and posted a public failure card tagging the owner, for an answer
nothing had lost. Seven review rounds and an hour unposted over one adjective.
