# Fresh-cut residue: what a reviewed owner-address line may subtract

**`fresh-cut verify` runs the [hygiene gate](hygiene-gate.md)'s private-term rows over every file of a cut.** No row
is narrowed for it. An `owner-address` finding a session has READ and judged a placeholder or not an address can be
accepted with `fresh-cut accept`, which appends one entry to `$SLOPWEAVER_HOME/fresh-cuts/reviewed-residue.jsonl`
(mode `0600`, append-only). An entry names the path, the class, the line's sha256, who read it and when, never the
text. Verify subtracts exactly those entries and prints `reviewed, accepted: N`. A changed line refuses again.

**`accept` refuses every other class**; those wait on the owner. It also refuses the path list's own locus, bare or
as a withheld path's `(file paths) line N`, even when a real file of the cut carries that exact name: a finding
about a PATH is never accepted or subtracted, so a file named like the locus fails closed.

**The report binds the sha256 of the list's exact bytes**, and the freeze audit re-reads the list WHOLE rather than
trusting the count. A malformed list, one blank line inside it, an entry of another class or a repeated entry id,
refuses the whole verify rather than subtracting what it could read.
