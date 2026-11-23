/** `slopweaver handover ask`'s help — a leaf, so the manifest quotes it without loading the verb. */

/** The verb's full help, printed by `--help` and under every usage refusal. */
export const ASK_USAGE =
  "usage: slopweaver handover ask <slug> --problem <line> --options <lines> --lean <line> " +
  "--risk <line> --blast-radius <line> --still-real <line> " +
  "(--example <scene> [--example <scene> ...] | --example-gap <line>) " +
  "[--base <value>] [--dir <value>] [--home <value>] [--question <value>] [--action <json|path|->] " +
  "[--read-owner-words <slug,...>]\n" +
  "  --example is the concrete scene the card leads with: second person, what they were " +
  "doing, what appeared, what the fleet did or wants to do, ending on the question. Up to three, numbered, " +
  "for related asks on one card. --example-gap says in one line why no truthful scene can be built.\n" +
  "  The SHAPE is mandatory: an ask the owner has to parse is a defect, so a " +
  "problem, two to four options, a lean, the risk, the blast radius and how it was confirmed still real " +
  "are what the owner reads, never a paragraph.\n" +
  "  --still-real is the check, not a date: the card ages it off the instant this verb records it.\n" +
  "  --options is ONE flag holding two to four LINES, each `<what they could do> :: <what that costs>`. " +
  "A line with no `::` states no trade-off and is refused by name.\n" +
  "  --question is the ask in full, kept for the thread and the journal. The card leads on the shape.\n" +
  "  An ask row already SETTLED is refused before anything is recorded: the board, reconcile and the Queue " +
  "skip a settled row, so its question would be on no surface. A new question goes on a new row " +
  "(`handover register`, which takes the question as its ask).\n" +
  "  On a row carrying the owner's words, every ready `talk-*` row registered after them is listed and the " +
  "ask REFUSED until the seat has read each and names them all in --read-owner-words: one may already answer it.\n" +
  "  --action offers a concrete Slack message (the draft, who it tags, and where it could go) or a MAIL " +
  "(version 2: the gmail draft form, previewed on the console, drafted only on the owner's press). Spell it " +
  "as `-` for stdin, as the JSON document itself, or as a path. --options is REFUSED beside it — one " +
  "option is derived per destination, in order, with HOLD last.";
