# Checking every quote against its source

A page or doc built on what someone actually said is checked mechanically before it ships, because the author
cannot see their own drift. Measured on an intent doc built from the owner's voice recordings: 137 passages
quoted from them, every one believed verbatim, and a mechanical check found **14 that were not**:

- **2 silent elisions** — filler ("like", "often", "I don't know") dropped from inside a quote with no
  ellipsis, which reads as tidier speech than the owner produced.
- **12 quote marks around non-quotes** — condensations of the owner's point, headings from
  `docs/constraints.md`, wording from a handover doc, and one proposition put TO the owner that they agreed
  with, all set in quotes as if the owner had said them.

A quote that is 95% accurate is worse than a paraphrase: it invites the reader to trust the other 5%. Re-reading
does not find it, because the tidied version is what the author meant and so it looks right.

## The check

1. Normalise both sides — case, punctuation, whitespace.
2. Take overlapping six-word runs from each quote.
3. Require a majority of them to appear verbatim in the source the quote is attributed to.
4. Find that source in **either** direction: prose puts the citation after the quote, a table puts it before.
5. Where a quote is cited only by a short date, fall back to "appears in at least one cited source", and say
   on the page that this weaker test was the one applied.

**Fix a failure by restoring the verbatim wording, or by removing the quote marks — never by loosening the
check.** Words put to the owner that they agreed with are attributed as the owner's agreement, not as
their words.
