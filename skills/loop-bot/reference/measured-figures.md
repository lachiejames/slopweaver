# 5 — a figure carries the command that measured it

The fourth show-your-work refusal, and DOCTRINE. Rules 1–3 ask whether a THING you named
is addressable, cited and photographed. This one asks the same question of a NUMBER, because a number is the
one claim in an answer with no referent to link. It arrived as a fleet FINDING, which is why its recorded
question carried its composer cost and not just the principle.

## Why it is a schema rule

There is already a rule that a measurement in CODE carries the command that reproduces it inline
(`.claude/rules/typescript-patterns.md` § Other rules, "Measured comments carry an inline repro command").
Nothing bound a number in an OUTBOUND ANSWER the same way, and the asymmetry is what the finding named: a
quantified claim asserted in prose with no measurement behind it recurred in every one of P2's four review
rounds, and both HIGH-impact breaks were counts with a date span attached. A reviewer caught each one by hand.
MEASURED over hundreds of verdict records: about one claim in seven came back unsupported. The
absolutes were a snapshot of a store that grows — the durable half is the share, about half of the
unsupported claims carrying a number.

## The shape

`answerArmSchema.measurements` is a list, and one entry is one COMMAND:

```json
{
  "figures": ["1,200", "3,400", "35%"],
  "repro": "slopweaver atlas datadog --alerts --window 30d",
  "takenAtIso": "2001-01-01T03:00:00.000Z"
}
```

One entry may carry every figure that one command produced, which is what keeps a table of numbers from
demanding a table of entries. Entries are bounded by distinct commands rather than by a `.max()`, and two
refusals with **no way past either** are what make that real: a `figures` member naming a figure the answer
never asserts, and a figure already covered by an earlier entry. So the list cannot exceed the answer's own
distinct figure count, and padding it to satisfy the other half is not available. That pairing is deliberate — a per-figure obligation against
a capped array is the mutually-exclusive-rules trap the citation budget already records.

The whole list renders below the fold, under **How each figure was measured**, in the evidence trail
(`src/outbound/assistant/evidence.ts`).

## What counts as a figure, and what is masked

A figure is a thousands-separated count (`91,131`), a bare three- or four-digit run (`227`, `1208`) or a
percentage, decimals included (`49%`, `98.7%`). Everything else is masked, and each exclusion came off one real answer rather than from
taste: an ISO date or datetime, a clock time, a bare year, a dotted version, a leading-zero padded field, a
bare run of five or more digits (that magnitude is an identifier), a digit run welded to a word (`sha256`,
`HRS-52`), and a figure already written as a `link` run, which points at what produced it.

The criterion is narrow on purpose. MEASURED over 180 real reviewed answer forms: the naive
every-digit reading demands a median of 20 entries per answer and a max of 127 — a hatch that is always open.
The shipped criterion comes to a median of 2, a p90 of 11 and a max of 50, with 39 of the 180 owing nothing at
all. `src/outbound/assistant/measuredFigures.ts` carries the four-row narrowing table and the `jq` repro.

Three residues are stated rather than papered over: a bare run of five or more digits that really is a count
(`91131` written without its comma) is masked and ships unrefused; a decimal with no percent sign (`1,208.5`,
`$1,250.00`) is masked, which measures ZERO across those 180 answers; and a date SPAN — "across 12 days" — is
covered only through the figure inside it, never as a span.

## The two halves, and the one override

- **A figure with no measurement covering it** is refused at its own path (`body.3`, a table `rows` index, or
  `lead`), one refusal per DISTINCT figure. Break-glass, journalled:
  `slopweaver hatch open unmeasured-figures --reason "<why>"`. The refusal line names it.
- **A measurement naming a figure the answer never asserts**, and **a figure covered twice**, have NO hatch,
  and the refusals say so. Together they bound the array, so a way past either would remove the bound.

The row's `standing` is `ruled`, off a recorded question that put the composer
cost in front of the owner: a median of 2 entries over 180 real reviewed answers, 39 of them owing nothing,
worst 23. So the exception list and the required `takenAtIso` are the owner's, and quoting them as doctrine is correct.
