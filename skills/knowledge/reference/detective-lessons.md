# Detective lessons — what a store investigation records, and how a wrong one gets corrected

The register the [SKILL.md](../SKILL.md) describes, used by the Haiku detectives the bot-turn session fans
out ([../../loop-bot/reference/detective-fanout.md](../../loop-bot/reference/detective-fanout.md)).

The point: a remembered false positive or false lead from a common query can tell the next investigation to
exclude it for that kind of use case.

And the limit on it: be cautious whether the memory is actually correct. A remembered thing can turn out to be
wrong, and acting on it is detrimental to future behaviour because the work then runs off bad data.

## A gotcha or an exclusion is a lesson; a dead end is a trace

A detective's GENERALISED finding is a LESSON, recorded through the contract that already exists.
`kind: "lesson"`, `--domain store-detective`, and the subtype lives in the claim's own wording. **No second
register**, because **`recall` ranks CLAIMS and selects each claim's latest recording before searching** —
that is what makes a correction work: a `refuted` recording can never be hidden by the older `confirmed` one
that scored better, and a parallel store would have to re-earn it.

The three-question entry test in [SKILL.md](../SKILL.md) still governs. A detective that searched and found
nothing has not learned a lesson — **it has made a TRACE**: the exact probe, empty, and what that emptiness
does not prove, written with `knowledge trace` ([traces.md](traces.md)). A detective that
found out WHY the obvious search finds nothing has learned a lesson. A remembered dead end never skips a leg.

## Where the reports land

The owner's question — whether all the memories and findings that accumulate as the detectives go are landing
somewhere — has one answer per kind of thing:

- **A lesson or a trace** lands in the `memories` table through `knowledge record` / `knowledge trace`, and
  the next wave's `knowledge detect` reads it back.
- **A wave's briefs and reports** land in the TURN'S RECORD SET when the verb is given the turn:
  `store detect … --ask <channel>/<messageTs>` (and `knowledge detect` the same) writes to
  `live/slack/detectives/<channel>-<messageTs>/<store|recall>-<ms>/`, beside a `wave.json`. A wave passed
  `--out` into the session scratchpad dies with it. Without `--ask`
  the wave lands under `detective/` and the verb says a freeze will not find it; `--ask` beside `--out` is refused.
- **`turn freeze` carries each `wave.json`, never the prose.** A report quotes what its detective read,
  unredacted, and the fixture redactor is an allowlist over JSON keys (`src/detective/waveHome.ts`).

## A gotcha

Something about how this store answers that the next detective would otherwise pay to re-derive.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge record \
  --domain store-detective \
  --claim "A person's name reaches only a fraction of the records that mention them through the exact shape, because to_tsvector tokenises on punctuation and the name is usually inside an address, a mention or a URL." \
  --verdict confirmed --tier 2 --surface cli \
  --evidence "live store, a couple of million rows: keyword barten — exact a few dozen, wild-both thousands." \
  --repro 'slopweaver store probe barten' \
  --caveat "Measured on one name. A name that is also an ordinary English word will behave differently." \
  --run <the board row this turn is on>
```

**Tier 2, and the tier is the judgement rather than a default.** A shape that returns dozens where thousands exist
raises no error anywhere — it is a wrong answer with nothing to notice — which is what tier 2 holds.

## A false-lead exclusion

Narrower than a gotcha, and the narrowness is the whole safety of it: it names a query FAMILY, a source or
container, and a window, never "ignore this channel".

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge record \
  --domain store-detective \
  --claim "For a pull-request-number question, the wild-both hits in the Zendesk notification channel were ticket ids of the same digits and none referred to the pull request." \
  --verdict confirmed --tier 3 --surface cli \
  --evidence "probe 17000 — wild-both 20, of which the Zendesk channel's were #170006 ticket notifications. Records read: <ids>." \
  --repro 'slopweaver store probe 17000 && slopweaver store groups --term 17000 --shape wild-both --facet container' \
  --caveat "Inspected records, not the whole cell. This does not establish that the channel is never relevant."
```

Three rules bind an exclusion, and each one exists because the alternative is a permanent blind spot:

1. **It never narrows the first probe.** The whole-store counts are run unfiltered, every time. An
   exclusion is applied to what a detective READS, after it has seen what it is skipping.
2. **It is re-checked on a sample before it is believed**, and the report says whether it held. A detective
   that applied an exclusion without looking has not investigated, it has obeyed.
3. **The discovery detective is never given it.** That lead exists partly to find out that an exclusion is
   wrong, and handing it the exclusion would close the only door left open.

## Correcting one that turns out to be wrong

**Same `--domain` and the same `--claim` text, byte for byte, with `--verdict refuted` and the new
evidence.** Not a new claim — the claim id is derived from the claim, so rewording it mints a second claim
and leaves the old `confirmed` recording standing as the one `recall` returns.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge record \
  --domain store-detective \
  --claim "<the ORIGINAL claim, unchanged>" \
  --verdict refuted --tier 3 --surface cli \
  --evidence "<what you observed that contradicts it, with record ids and the date>" \
  --repro '<the command that shows it>'
```

A refuted row is regraded, never deleted mid-task; it keeps what it used to say alongside what is true now,
and the correction is itself the lesson. Removal is a reviewed hygiene pass only: [prune.md](prune.md).

## Who writes it

**The visible bot-turn session, not the detective.** A detective returns its candidate lessons in its
report; the session that can see every report checks the evidence, drops the ones that are a suspicion
rather than a measurement, and records what is left. Two detectives independently proposing the same claim
is a stronger row than either — and `knowledge list --repeats` is what makes that visible later, ranked by
distinct RUNS rather than by raw count.
