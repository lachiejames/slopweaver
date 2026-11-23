# Composing the RoutingDecision

The exact JSON shapes `turn dispatch` accepts, the private profile and owner directives that bind the
judgement, and the two renderings a decision commits the answer to. The rule — decide the way a person would,
never by matching capability terms against the question — is in [SKILL.md](../SKILL.md).

`turn brief` prints exactly what this context can and cannot reach, and the exact shape to write. To read a capability's contract without judging a turn, use the read-only door — [turn-mechanics.md](turn-mechanics.md) — instead of re-running `turn brief` on a live ask.

It also states whether a private judgement/voice profile was loaded. When loaded, read
`routingInput.profile` from the brief path it prints: apply `routing.*` while making this decision and
`voice.*` while composing every answer. Never quote the private profile. Recent exact-rule misses, when
present, are printed as a bounded pain-point list; treat them as concrete things not to repeat.

The brief separately states whether `routingInput.ownerDirectives` contains current owner rulings. Read and
apply every directive whose described situation matches the turn, to both action and authored voice where
relevant. A matching directive overrides conflicting mined-profile guidance: it is the owner's explicit newer
decision, while the profile is the slower evidence-derived baseline. Never quote the private directive.

```json
{ "schemaVersion": 1, "response": "no-response", "confidence": "high", "rationale": "why no reply is owed" }
```

or, when a reply IS owed but a PERSON should give it and the bot stays out (it settles to `:for-a-human:`,
never `:ack:`, and never takes `exclude`)

```json
{ "schemaVersion": 1, "response": "for-a-human", "confidence": "high", "rationale": "why a person should answer" }
```

or

```json
{
  "schemaVersion": 1,
  "response": "respond",
  "tier": "fresh-visible-session",
  "needs": [],
  "truthMode": "current",
  "confidence": "high",
  "rationale": "why this tier and these needs",
  "model": "opus"
}
```

`"model"` applies to `fresh-visible-session` only, pinning the worker at boot (Opus when absent — the
explicit default, never the saved one); name `"sonnet"` when you can see the ask is narrow.

**This is the whole point of the doc this loop implements: decide the way a person would, not by matching
capability terms against the question.** A bare "yo" needs `no-response`? No — a person addressed like that
replies casually; that is `respond`/`inline`, from context and judgement, never silence and never a corpus
lookup. _"what are my open PRs?"_ needs a live verb — `respond`/`inline` (or `fresh-visible-session` when it
needs real depth) with `needs: [{"capabilityId": "fleet-status", ...}]`. A question about a surface `turn brief`
listed UNAVAILABLE is the one case where a good-looking answer IS the failure — the corpus holds only people
_discussing_ it — so say plainly what you cannot see rather than judging a live tier for it.

Every `needs[].capabilityId` must name a capability `turn brief` listed — AVAILABLE or HISTORICAL — never
`corpus` (reserved), never one it listed unavailable. **A PROPOSAL-shaped ask must go and look before costing
it**: the thing may already exist, and both verbs refuse a decision or answer that skipped that check — see
[turn-mechanics.md](turn-mechanics.md).

**A "list my PRs"-shaped answer gets a colour-coded, hyperlinked line per PR, not a plain paragraph.** Use
`prLineRuns`/`prGroupHeading` (`src/outbound/assistant/prListRender.ts`) inside a `bullets`/`list` body block:
a status glyph (🟢 ready · 🟠 needs attention · 🔴 failing · ⚪ building · 🟣 merged), the full title as a real
hyperlink, and — when there is one — a pipe-separated note naming who it is waiting on or what is blocking
it. Whether to group PRs at all, and under what heading, is YOUR judgement each time — a real GitHub stack
relationship, a topical similarity you actually noticed reading the titles, or no grouping at all — never a
fixed heuristic; the module deliberately has no auto-grouping of its own.

### A question about PEOPLE is routed like any other

**There is no judgement to make about whether a question should have been asked.** A question whose honest
answer ranks, compares or names colleagues — "who has been slowest to close out their assigned tickets" is
the worked example — is judged on its evidence needs exactly like any other, and answering it correctly
is the bot working as intended. Tact is the ASKER's onus; yours is the most accurate, citation-backed answer,
and `turn brief` prints that rule under `WHAT MAY BE ASKED` on every turn.

So never `ignore` it, never `block` it for an approval it does not need (block's triggers are a sign-in and a
risky mutation; a read and a post is neither), and never judge it a narrower question than the one asked.
Accuracy is untouched: a ranking you cannot evidence is a wrong answer about named people, which is the one
outcome worse than the refusal this rule forbids. The rule, the worked case and what it does not license:
`../../loop-bot/reference/tact-is-the-askers-onus.md`.

### Displeasure quoting the bot's own words is a STOP, not an ask

**A complaint that quotes this bot's last answer back is a verdict on the turn that just ran.** Do not
dispatch a fresh investigation to "answer" it. Measured: `> the monitors are not deployed ... these
charts are a replay of the pr's queries and thresholds over real cost data @<bot> thanks for nothing` was
judged `respond`/`fresh-visible-session`, and a whole new Opus worker went off to guess at a diagnosis the
person holding it would have given in one line. `turn brief` prints a STOP block whenever an addressing
message carries both a quoted line and a displeasure phrase (`src/live/turn/ownerDispleasure.ts`); read it.

What is owed instead: say back in one line exactly what you believe was wrong, quoting the part of the ask
the answer did not discharge; ask the ONE question that settles it if you still cannot tell — a recorded
question is a legitimate ending; and record it with `slopweaver turn breakage`, its `--cause` naming what the answer missed, so it binds later turns. Re-run the
original work only once you know WHICH failure you are fixing. No apology without an artefact.

### Which skills own the subject — the brief names them

`turn brief` ranks every skill this build and every declared main checkout carries against the question, and
prints the candidates with their own descriptions. Read the ones that apply and name each in the answer's
`grounding.provenance.skillsLoaded`; the send door warns on an answer that loaded NOTHING while a candidate
clearly owned the subject. MEASURED over 43 dispatched worker turns: 31 (72%) held no skill at
all, because nothing put one in front of them. An empty list is a real answer — silence is the defect.

### The investigation happens in the WORKER, not here

`slopweaver catalog` lists the verb surface; the worker reads Slack with agent-chosen depth (`slopweaver slack
read-thread <permalink> [--around n] [--channel-around n]`), widening or following relevant thread links only
when the evidence warrants it, checks live state, reads the repo — `skills/loop-bot/SKILL.md` specifies that
behaviour in full and it applies to the worker unchanged. The spend lever is **which model produces the
output**, and it is pulled at DISPATCH: name `"model"` on the decision to right-size the worker (Opus by
default for an open investigation; `sonnet` for an ask you can see is narrow), never by this loop doing the
leaf work itself. If you find yourself about to run `grep`, read a file, or call a live verb to answer a tag,
you have judged the wrong tier — stop, and dispatch.
