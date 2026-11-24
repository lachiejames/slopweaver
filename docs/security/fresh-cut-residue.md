# Fresh-cut residue: what an accepted line may subtract

**`fresh-cut verify` runs the [hygiene gate](hygiene-gate.md)'s private-term rows over every file of a cut.** No row
is narrowed for it. One finding at a time can be accepted with `fresh-cut accept`. It appends one entry to
`$SLOPWEAVER_HOME/fresh-cuts/reviewed-residue.jsonl` (mode `0600`, append-only). There are two tracks, and the class
decides which:

- **`owner-address`, on a reader's judgement.** A session READ the line and judged it a placeholder or not an
  address (`--as placeholder|not-an-address`). The entry matches that path, class and line in any cut.
- **Every other class, on an owner anchor.** `--anchor transcript:<session>#<turn>` points at the owner's own turn
  ruling on the line. `accept` resolves the pointer in the local transcripts and refuses one naming no owner turn,
  or a transcript it cannot read. The entry stores the pointer, never the turn's words. It matches only in the ONE
  record and tree it was accepted in, so a ruling on one cut never forgives the same line of another. Verify
  resolves the pointer of every such entry for its record again, and one that does not resolve refuses the whole
  verify, so a line written into the list by hand is never trusted. A process able to write both the list and a
  transcript can still forge one: this check makes an invented anchor fail, not an impossible one.

An entry names the path, the class, the line's sha256, the session that recorded it and when, and the anchor on the
second track. It never holds the matched term or the line's text. Verify subtracts exactly those entries and prints
`reviewed, accepted: N`, then the anchored share by class, so a clear that rests on the owner's ruling says so. A
changed line refuses again.

**`accept` refuses a mismatched track**: `--anchor` on `owner-address`, `--as` on any other class, or another class
with no anchor. It also refuses the path list's own locus, bare or as a withheld path's `(file paths) line N`, even
when a real file of the cut carries that exact name: a finding about a PATH is never accepted or subtracted, so a
file named like the locus fails closed.

**The report binds the sha256 of the list's exact bytes**, and the freeze audit re-reads the list WHOLE rather than
trusting the count. A malformed list, one blank line inside it, a line matching neither entry shape or a repeated
entry id, refuses the whole verify rather than subtracting what it could read.
