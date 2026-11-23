# answer-quality — the per-case self-test output, redacted

This is the evidence behind the scorer's gold claim: the ordering properties that prove
the scorer does not reward token overlap, shown per case rather than summarised into a counter. Every
string in the table below is either a closed union this repository declares or a label
`src/eval/answerQuality/artifact.ts` minted itself, so no golden text, expectation label, attribution
source, invented-certainty phrase — or even an id the case file authored — can reach it.

`case-1` and a case's `e1` are assigned in first-appearance order, and the verb prints what each one
stands for when it writes this file. That mapping is the operator's to read and is deliberately not here:
an id is usually named after what it tests, so publishing one leaks the thing this artifact redacts.

## Provenance

- input: the operator's own case file, sha256 `2dd4bddb23cd7cc5b7dd515887216c98ef4793c8245b79acdcd20b932ba08c5c`, 35209 bytes
- cases: 10
- outcomes: **69 passed, 0 failed, 0 skipped**

**Nothing in CI can re-derive this table**, because its input is not in git — that is the partition, not an
oversight. The sha256 is the whole mitigation: it makes a stale artifact detectable rather than impossible.
Re-cut it, and compare the digest to the file you hold, with:

```bash
slopweaver dev answer-quality --cases $SLOPWEAVER_HOME/eval/answer-quality-cases.json \
  --selftest --artifact eval/answer-quality-per-case.artifact.md
```

## How to read a row

`score` is the graded mean and `against` is what it had to beat — the golden's own score for a
`degrades-down` row, the overlap bound for the paraphrase row. A `degrades-down` row passes only when its
score is STRICTLY below the golden's, and a `certainty-invented` one additionally only when its band is
capped at DEGRADED or worse. Those two columns are therefore the claim itself, not decoration: read down
them and the ordering is either there or it is not.

| case | property | state | band | score | against |
| --- | --- | --- | --- | --- | --- |
| case-1 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-1 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.327 | 0.500 |
| case-1 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-1 | anchors-are-droppable | PASS | — | — | — |
| case-1 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.667 | 1.000 |
| case-1 | degrades-down · attribution-dropped · e2 | PASS | DEGRADED | 0.792 | 1.000 |
| case-1 | degrades-down · attribution-dropped · e3 | PASS | SOUND | 0.875 | 1.000 |
| case-1 | degrades-down · certainty-invented · e4 | PASS | DEGRADED | 0.917 | 1.000 |
| case-2 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-2 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.496 | 0.500 |
| case-2 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-2 | anchors-are-droppable | PASS | — | — | — |
| case-2 | degrades-down · attribution-dropped · e1 | PASS | DEGRADED | 0.667 | 1.000 |
| case-2 | degrades-down · certainty-invented · e2 | PASS | DEGRADED | 0.833 | 1.000 |
| case-3 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-3 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.403 | 0.500 |
| case-3 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-3 | anchors-are-droppable | PASS | — | — | — |
| case-3 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.667 | 1.000 |
| case-3 | degrades-down · certainty-invented · e2 | PASS | DEGRADED | 0.833 | 1.000 |
| case-4 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-4 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.302 | 0.500 |
| case-4 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-4 | anchors-are-droppable | PASS | — | — | — |
| case-4 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.750 | 1.000 |
| case-4 | degrades-down · attribution-dropped · e2 | PASS | DEGRADED | 0.750 | 1.000 |
| case-4 | degrades-down · certainty-invented · e3 | PASS | DEGRADED | 0.875 | 1.000 |
| case-5 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-5 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.452 | 0.500 |
| case-5 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-5 | anchors-are-droppable | PASS | — | — | — |
| case-5 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.750 | 1.000 |
| case-5 | degrades-down · attribution-dropped · e2 | PASS | DEGRADED | 0.688 | 1.000 |
| case-5 | degrades-down · certainty-invented · e3 | PASS | DEGRADED | 0.875 | 1.000 |
| case-6 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-6 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.274 | 0.500 |
| case-6 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-6 | anchors-are-droppable | PASS | — | — | — |
| case-6 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.750 | 1.000 |
| case-6 | degrades-down · attribution-dropped · e2 | PASS | DEGRADED | 0.750 | 1.000 |
| case-6 | degrades-down · certainty-invented · e3 | PASS | DEGRADED | 0.875 | 1.000 |
| case-7 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-7 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.360 | 0.500 |
| case-7 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-7 | anchors-are-droppable | PASS | — | — | — |
| case-7 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.500 | 1.000 |
| case-7 | degrades-down · caveat-dropped · e2 | PASS | UNSOUND | 0.333 | 1.000 |
| case-7 | degrades-down · attribution-dropped · e3 | PASS | DEGRADED | 0.500 | 1.000 |
| case-7 | degrades-down · certainty-invented · e4 | PASS | DEGRADED | 0.833 | 1.000 |
| case-8 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-8 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.360 | 0.500 |
| case-8 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-8 | anchors-are-droppable | PASS | — | — | — |
| case-8 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.667 | 1.000 |
| case-8 | degrades-down · attribution-dropped · e2 | PASS | DEGRADED | 0.750 | 1.000 |
| case-8 | degrades-down · certainty-invented · e3 | PASS | DEGRADED | 0.875 | 1.000 |
| case-9 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-9 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.320 | 0.500 |
| case-9 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-9 | anchors-are-droppable | PASS | — | — | — |
| case-9 | degrades-down · certainty-invented · e1 | PASS | DEGRADED | 0.750 | 1.000 |
| case-10 | verbatim-golden-scores-top | PASS | TOP | 1.000 | — |
| case-10 | paraphrase-is-measurably-a-paraphrase | PASS | — | 0.317 | 0.500 |
| case-10 | paraphrase-scores-top | PASS | TOP | 1.000 | — |
| case-10 | anchors-are-droppable | PASS | — | — | — |
| case-10 | degrades-down · caveat-dropped · e1 | PASS | DEGRADED | 0.750 | 1.000 |
| case-10 | degrades-down · attribution-dropped · e2 | PASS | SOUND | 0.875 | 1.000 |
| case-10 | degrades-down · attribution-dropped · e3 | PASS | SOUND | 0.875 | 1.000 |
| case-10 | degrades-down · certainty-invented · e4 | PASS | DEGRADED | 0.875 | 1.000 |

