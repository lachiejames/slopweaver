# 6 — a small-sample figure states its n in the same sentence

The fifth show-your-work refusal, set on the
`reviewer-catches-structurally-impossible` page. Class C on that page is "a small sample read as a trend".
A reviewer repeatedly objected to a latency median because its sample was small, never because its direction
was wrong. The page offered three placements for
the qualifier: inline in the sentence, down in the fold, or left to review. The owner took inline, because it is the
only placement a reader who never expands still sees.

## The shape

`answerArmSchema.samples` is a list, and one entry is one figure:

```json
{ "figure": "12.4s", "n": 6 }
```

`figure` is spelled EXACTLY as the answer writes it. `n` is how many observations produced it: spans,
requests, days, tickets, whatever the query counted. The list is not rendered. The n a reader needs is the
one you write into the sentence itself:

> FixtureCheckout p50 is 12.4s (n=6), so treat the trend as a lead rather than a finding.

## What is refused

- **A figure under 50 whose sentence does not carry `n=<n>`**, at the lead, index line, paragraph, bullet or
  table row it sits in. The same sentence, not the same bullet: `12.4s. that was n=6.` is refused. `n = 6`
  and `(n=6)` both count. In a table the whole row is one unit, and a cell under a column headed `n` reads
  as `n=<cell>`, so a `6` in that column satisfies it.
- **A declared figure the answer never asserts**, and **a figure declared twice**. These two bound the list,
  so it cannot outgrow the answer's own figures.

At 50 or above, nothing is owed inline and declaring the figure is harmless. There is no hatch on any leg,
because the fix is always available: write the n, or delete the entry.

## Why 50, and why you declare it

Fifty is MEASURED on the class-C thread's own verdicts. In the reproduced verdict evidence, every stable cell
was above the chosen boundary and every drifting cell below it; 50 is the separating integer selected from
that observed gap. The `jq` repro is in `src/outbound/assistant/smallSamples.ts`'s header. One thread is one data
point, so the threshold is one constant, ready for the next measurement.

The form cannot find a sample size by scanning. `12.4s` is masked by the figure criterion `measurements` uses
(`measured-figures.md`), and the n of a number is not in the answer's bytes at all. You know it, from the
query that produced the number. **So an undeclared sample is unchecked: that is the rule's stated residue,
and declaring every sampled figure you assert is the composer's half of it.** A p50, a p95, a median or a
mean read off spans or requests is the case this exists for. A metric rollup with no countable population
has no n to declare.
