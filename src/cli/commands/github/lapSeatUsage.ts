/**
 * The usage line of `slopweaver github lap-seat`, and nothing else — a LEAF, so the manifest barrel can quote it
 * without loading the verb.
 */

/** `slopweaver github lap-seat`'s usage. */
export const GITHUB_LAP_SEAT_USAGE =
  "usage: slopweaver github lap-seat set <slug> | clear | show [--home <dir>]\n" +
  "  Name the ONE handover run whose session may run `github lap` while the chair's rota stands. Every other\n" +
  "  session's lap (a batch and every landing mode included; a dry run exempt) is refused before it reads\n" +
  "  anything, naming the seat: it sends its pull request number and head SHA to the chair instead.\n" +
  "  set <slug>   designate an open run; refuses a slug never started, or one already closed\n" +
  "  clear        remove the designation, even a damaged one; no rota stands until the next set\n" +
  "  show         print the designation, then the lap holding the machine's lock and its phase (preflight\n" +
  "               or running); exits 3 when no designation stands\n" +
  "  A designated run that has CLOSED, or a seat file or journal that will not read, refuses every lap\n" +
  "  until set or cleared: only the chair ends a rota. A reseated lap seat claims its run first (`handover claim`).\n" +
  "  --home <dir>  the state home whose laps/seat.json is read or written\n";
