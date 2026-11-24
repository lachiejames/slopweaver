# Fresh-cut residue: what an accepted line may subtract

**`fresh-cut verify` runs the [hygiene gate](hygiene-gate.md)'s private-term rows over every file of a cut.** No row
is narrowed for it. One finding at a time can be accepted with `fresh-cut accept`. It appends one entry to
`$SLOPWEAVER_HOME/fresh-cuts/reviewed-residue.jsonl` (mode `0600`, append-only). There are two tracks, and the class
decides which:

- **`owner-address`, on a reader's judgement.** A session READ the line and judged it a placeholder or not an
  address (`--as placeholder|not-an-address`). The entry matches that path, class and line in any cut, at the
  line's `occurrence`: its index among the file's lines with those exact bytes.
- **Every other class, on an owner anchor.** `--anchor transcript:<session>#<turn>` points at the owner's own turn
  ruling on the line. `accept` resolves the pointer in the local transcripts and refuses one naming no owner turn,
  or a transcript it cannot read. The entry stores the pointer, never the turn's words. It matches only in the ONE
  record and tree it was accepted in, so a ruling on one cut never forgives the same line of another. Verify
  resolves the pointer of every such entry for its record again, and one that does not resolve refuses the whole
  verify, so a line written into the list by hand is never trusted. A process able to write both the list and a
  transcript can still forge one: this check makes an invented anchor fail, not an impossible one.

An entry names the path, the class, the line's sha256 and number, the session that recorded it and when, the
occurrence on the first track and the anchor on the second. It never holds the matched term or the line's text.

**An entry clears only the one line it was accepted for**, never a byte-identical copy that verify meets first.

- An anchored entry matches only in its own record and tree, where nothing can move, so it binds to its exact line.
- An `owner-address` entry binds to its occurrence in any cut. That survives lines moving above it, but not a new
  identical copy inserted above it.
- An `owner-address` entry written before the occurrence field existed is never rewritten. It binds to its stored
  line in its own record and tree. Anywhere else it binds only when the file holds exactly one copy of the line,
  and with two or more copies it clears nothing.

Verify prints `reviewed, accepted: N`, then the anchored share by class, so a clear that rests on the owner's ruling
says so. It then prints `reviewed, unmatched: N`. That counts every entry that applies to the cut but took nothing
out: its line changed, its occurrence is gone, it is ambiguous, or its line is not flagged. The unmatched count is
printed only and is not written to the report. It never changes whether the cut is clear. A changed line refuses
again.

**`accept` refuses a mismatched track**: `--anchor` on `owner-address`, `--as` on any other class, or another class
with no anchor. It also refuses the path list's own locus, bare or as a withheld path's `(file paths) line N`, even
when a real file of the cut carries that exact name: a finding about a PATH is never accepted or subtracted, so a
file named like the locus fails closed.

**The report binds the sha256 of the list's exact bytes**, and the freeze audit re-reads the list WHOLE rather than
trusting the count. A malformed list, one blank line inside it, a line matching neither entry shape or a repeated
entry id, refuses the whole verify rather than subtracting what it could read.
