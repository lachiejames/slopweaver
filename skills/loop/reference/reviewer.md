# The reviewer: opened through the verb, briefed by code

Bundled reference for the `loop` skill. Loaded when the body links here, not on every turn.

## No verdict, no send — and the session that composed the answer never briefs its reviewer

**No verdict, no send.** `turn answer` refuses an answer nothing but its author has read. No answer beats a bad answer.

**The reviewer's instructions are composed by CODE, from the answer's own bytes — never by the session that
composed the answer, and never by this loop either.** That is the whole guarantee, and it is not a formality:
a session can grade its own homework through another session if it wrote that session's instructions. Since the worker owns
its ask to the terminal outcome — it posts, so it has to be the one that gets the answer reviewed — the rule is
kept by `slopweaver turn review`: it re-validates the answer, computes its digest, writes a packet that is a
deterministic function of the answer, the decision and the brief, boots a second visible cmux session pinned
to a model, records where that session is, and only then sends it one pickup line pointing at the packet. The
worker presses the button; it does not write a word the reviewer reads, and the packet tells the reviewer so.

```bash
# the worker, from inside its dispatched workspace
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --dispatch <id> --answer <absolute answer path> --read-through <newest human ts you read>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --dispatch <id> --poll --wait --timeout-seconds 1200   # background it; exit 4 = still working
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --dispatch <id> --close     # once you are done with the reviewer

# this loop, for an inline trivial ack it composed itself
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --brief <brief path> --decision <decision file> --answer /tmp/answer.json --read-through <ts>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn review --brief <brief path> --poll --wait
```

**`--poll` OBSERVES; `--close` CONSUMES. They are two verbs on purpose.** As one, the cost was measured:
the verdict path is fixed per ask, so a file a PREVIOUS round's reviewer left there made every
poll classify the review finished and CLOSE the reviewer that was mid-verdict — twelve
reviewer workspaces died that way in two hours, each matched to the poll that killed it within a second by
cmux's own closed-item history, while the poll printed only that the digest did not match.

`--poll` closes nothing; `--wait` re-reads while the reviewer works (exit 4 on timeout). THIS reviewer's own
verdict for these bytes prints `verdict: <outcome> <path>`, exit 0 — the path `turn answer --verdict` takes.
Otherwise it names the reviewer's state (the three below, or a phantom workspace: run `turn review` again),
exit non-zero. A previous round's verdict landing AFTER this round opened is archived, recorded, read again.

**A missing delivery record is a DOUBT in both directions, so the poll reads the SCREEN.** A missing verdict
never meant the reviewer read a word (one workspace sat fourteen minutes with its pickup unsent),
and absence never proved non-delivery (a reviewer read WORKING at 5m22s was called NEVER STARTED).
Only the middle of three answers says act: `still working` (a turn running or a message queued — leave it
alone); `reviewer pickup TYPED AND UNSENT` (an IDLE box, so `turn dispatch --sweep` presses Enter on the copy
already there); and `reviewer delivery UNWITNESSED`, the doubt — **confirm with
`slopweaver cmux read-screen --workspace <ref>` before re-submitting.**

**Do NOT type the line in by hand**, on any of the three, and never `mv` a verdict file: `record.json`'s
`answerDigest` is the authoritative one, the verdict file's only a claim about what that reviewer saw, and a
REFUSED line about a previous round's file means the poll's own archive failed and says why. Bound the wait
yourself — see the end of this file for a reviewer that never returns.

`--close` releases the reviewer's workspace, and only when the reviewer is provably not working: its own
verdict is written, or cmux says the host has exited. It refuses otherwise. You do not have to remember to
archive anything before a re-review — opening a review moves any verdict already at the path to
`verdict-superseded-<reviewer>-<when>.json` itself, before it spawns. A reviewer left open after its verdict
shows up on `turn dispatch --sweep`'s own still-working line, so a forgotten `--close` is visible rather than
silent.

**And a forgotten `--close` strands nothing, because the ask's TERMINAL path releases the reviewer
itself.** `turn answer` reaps it once the answer has posted, and `turn dispatch --sweep` reaps it on each of
its three terminals (worker-failed, lease-expired, phantom) — code, not a step you have to remember. That is
not a nicety: measured, six reviewer workspaces were left standing on ONE ask, a real share of a
46-session pile-up, and the reason is structural rather than forgetfulness — `turn answer` closes the
WORKER'S OWN workspace as its last act, so a worker that has not released its reviewer by then is gone and can
never do it. `--close` stays the verb for releasing one mid-ask, where the liveness gate still matters.

**A pickup line that is not confirmed is not yours to hand-deliver, and it is not `turn review`'s to re-send
either.** It waits for the host to render a prompt and sends ONCE. If nothing witnesses the line arriving it
says so on stderr and carries on: measured, a prompt QUEUED in a child's input can raise no hook,
name nothing in cmux's `latest_submitted_message` and show an idle prompt, so an unwitnessed send is far more
often a landed one than a dropped one — and a second copy runs the whole packet again when the session's
first turn ends. Poll for the verdict as normal. Only a send cmux itself REFUSED is a failure, and that one
does refuse the verb; there, read the surface and close and re-open the review rather than typing it in.

**The reviewer's model is pinned at boot** (`--model`, defaulting to the reviewer default in
`src/live/turn/workerModel.ts` — the same tier as the default worker, never lower: the small context is what
lets the reviewer run on a good model). Boot-time only; a running session is never sent a `/model` switch.

Two edges worth naming, because they are the ones that come up:

- **A burst, or a double-tag on the same topic, must not double-spawn.** One answer is one review. Two tags
  that are really one question get one reviewer, not two — fold the second tag into the ask already in flight
  ([worker-contract.md](worker-contract.md) § "A rapid-tag burst") rather than judging it a new question.
- **A second reviewer is a judgement call, not a default** — a claim resting on two unrelated kinds of
  evidence, say. `turn review` opens one; a second is a second call with its own verdict, and the door takes
  one `--verdict`, so this is rare and you should be able to justify it in a line.

## Rounds: a re-review continues the last one, and a late one cannot be bought with a new nit

**The packet says which ROUND this is, and lists what the previous round left `high`-impact and unresolved.**
A round exists to settle what the last one named. Without that list a reviewer re-derives the material claims
from scratch and derives a different set, which is one half of how an ask reaches six rounds; the record
carries `round` and `carriedUnresolved` so it does not have to.

**Past `REVIEW_ROUND_CAP` (3, in `src/live/turn/reviewRounds.ts`) the packet NARROWS what a late round may
escalate** — and nothing about that lowers the bar. The standing claims still bind, every carried claim still
binds, and a new `high`-impact finding about something the question DID ask for is still `high` impact. What
stops earning another round is a brand-new finding about analysis the question never requested: it is `low`
impact past the cap, whatever it turns up. Measured — six rounds over two hours, six reviewer
sessions, all of them rigorous, none of them about what the ask wanted, on an answer that never carried the
link the ask existed for.

**The cap never REFUSES a round** — that would take the fix-and-re-review path away, not the six rounds — so
crossing it narrows the packet and writes one `loop-breakage` row. The one refused round follows a CLEAN one:
there is nothing to fix, so `turn review` prints the code diff and the cleared answer to post instead
([reviewer-packet.md](reviewer-packet.md)). Every packet also carries a clock and a parallel-read instruction.

**And the tier is yours to decide, per tag.** Inline for a trivial ack, a worker for anything that needs
research — you choose, reading the tag. Arriving in the queue never decides how a tag gets worked; this
loop's judgement does, and that judgement is a visible session's. That is the same property rule 2 protects
everywhere else in this system: what runs is what a visible session chose to run.

## The verdict, and the four fields that stop it being a rubber stamp

The reviewer writes a JSON file at the path the packet names; `--poll` hands you that path for `--verdict`:

```json
{
  "schemaVersion": 1,
  "answerDigest": "<the digest the packet quoted — the same one `turn answer --answer /tmp/answer.json --print-digest` prints>",
  "authorSession": "author workspace workspace:N (<id>)",
  "reviewerSession": "reviewer workspace workspace:M (<id>)",
  "outcome": "clean",
  "claims": [
    {
      "text": "the staging pool exhausted at 14:02",
      "support": "supported",
      "impact": "high",
      "evidence": "the thread at <permalink>, and the two records it cites"
    }
  ],
  "imageObservations": [
    {
      "path": "/shots/pool-errors-15d.png",
      "artifactDigest": "<the digest section 1c printed beside that path>",
      "observedContent": "the 15d timeseries, query env:staging @err.code:(P2024 OR P2028), y axis 0 to 40, peak 31 on jobs-api",
      "targetState": "data",
      "legible": true,
      "contextRetained": true
    }
  ]
}
```

- **`answerDigest`** binds the verdict to the exact answer, and the door re-computes it. The packet quotes
  it; `turn answer --answer <path> --print-digest` prints the same value and posts nothing. It is NOT a
  `sha256sum` of the file — the door hashes the answer AFTER parsing it, so whitespace and key order are
  normalised away and a hand-computed file hash is refused as stale for a review that was actually sound.
  Edit the answer after review and the send refuses too — which is the point, because a verdict for a
  previous draft reads as diligence while being none.
- **`authorSession` and `reviewerSession`** must differ, and the packet names both exactly — the worker's
  workspace and the reviewer's, by ref AND id. Nothing here can authenticate either, so this does not prove
  independence; it makes grading your own homework a thing you have to WRITE DOWN rather than do quietly, and
  a stated lie is auditable in a way a silent one is not.
- **`claims`** is what turns "is this good?" into a list of things each of which is supported or is not.
- **`imageObservations`** is EXACTLY one entry per attached picture — no more, no fewer — and the door
  matches `path` and `artifactDigest` TOGETHER against the bytes it is about to upload. Absent means the
  empty list, which is exact coverage for an answer that attaches nothing.

**Every attached picture is OPENED, and what you saw is written down.** This is packet section 1c, it binds
on every round, and it is not what section 1b covers: 1b is a ceiling on a picture that is ABSENT. Two
4032-pixel-wide full-page Datadog screenshots, one photographed before its panel had rendered, passed six review
rounds and were unacceptable; that is what separated them.
Round 4's reviewer DID open one and wrote a true, supported, `low`-impact claim about it: it asked whether
the picture backed the claim and answered correctly, and nobody had asked whether a human could read it.

So an observation answers four things a claim cannot carry — `observedContent` (the concrete values, labels
and query actually visible, never "looks fine"), `targetState` (`data`, or `zero-results` for a query that
legitimately matched nothing, or `unloaded`/`empty-panel` for one that had not rendered), `legible` (at the
size Slack renders the PREVIEW, not the file you just opened), and `contextRetained` (are the axes, query
and time range still in frame). Any of `legible: false`, `contextRetained: false`, or an unrendered
`targetState` makes the picture UNFIT: name the matching `unfitReason` and mark the verdict `broken`.

**An unfit observation is durable and has no way past it.** The door writes a `failed` image record against
those exact bytes before it refuses, so they can never be attached again — by any verb, in any later turn,
with no hatch and no token. A coverage GAP is different: it is a self-correctable warning
(`answer.image-observations:v1`). Re-capture or re-crop to correct an unfit picture; the new bytes are a
different picture and get their own look.

**A capability self-assessment is a claim like any other.** When an answer says what the bot can or cannot do
— _"I can reassign these"_, _"I have no way to see that"_ — the reviewer checks it against the real verb
surface (`slopweaver catalog`, and the brief's own available/unavailable capability lists), exactly as it
checks a claim about the world. It is not a stylistic aside and it is never taken on the author's word.
Measured on a live IAM ask: an overclaimed capability cost the owner a restore plan built on
something that does not exist, which is worse than the answer having said plainly that it could not act.
Grade an unsupported one `high` impact — acting on it is what the reader will do next.

If the reviewer does not return, **the answer does not go**; a worker reports `turn resume --failed` and the
sweep finalises the thread from that. If it returns `broken`, or leaves a `high`-impact claim unresolved, the
door refuses and names which claim — fix the answer, re-validate it, and open a fresh review, since the digest
of the new bytes will not match the old one anyway.

**A verdict the door would accept as it stands is not something to improve on**, and `turn resume --answer`
refuses bytes that would discard one until `--edit-reason` says why — the rule, and the incident that refutes
"a clean verdict ends the review", are in [worker-contract.md](worker-contract.md) step 2.

What the packet carries, what the door checks about the answer, and how a `fresh-visible-session` turn
posts differently: [reviewer-packet.md](reviewer-packet.md).
