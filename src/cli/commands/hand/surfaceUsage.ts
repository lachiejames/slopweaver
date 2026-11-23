/**
 * `hand surface`'s usage text — a leaf, so the manifest barrel can quote it without loading the command.
 */

/** The one usage line the manifest and the verb both print. */
export const HAND_SURFACE_USAGE_LINE =
  "usage: slopweaver hand surface --row <slug> --ask-slug <slug> --tried <line>... --doc <ref>... " +
  "--documented <line> --observed <line> --codex <line> --why <line> [--hedge <line>] " +
  "[--access <named access> --holder <person> --would-settle <line>] " +
  "--urgency breaking|blocked-send|fleet-idle|keen|close-call|none [--breaks <what> --by <when>] " +
  "[--send <the approved send>] [--if-silent <what could go wrong>] [--note-what <one sentence>] " +
  "--question <line> --problem <line> --options <lines> --lean <line> --risk <line> --blast-radius <line> " +
  "--still-real <line> --evidence <ref>... --observed-by <session> --context slopweaver|work " +
  "[--by-session <text>] [--json]";

/** The whole usage, printed on `--help` and on a parse error. */
export const HAND_SURFACE_USAGE =
  `${HAND_SURFACE_USAGE_LINE}\n` +
  "  A seat's honest mid-investigation report: what it tried, the docs it followed, what they say against what\n" +
  '  happens, the Codex cross-check, and why — "I do not know why" is a whole answer — plus any hedge offered in\n' +
  "  parallel and the named access, and its holder, that would settle it. Prints the report, then commands; runs\n" +
  "  none of them.\n" +
  "  EVERY report prints a `handover register --finding` line the seat runs itself: a Queue card that does not\n" +
  "  pause the investigation (--ask-slug is that NEW row, never --row).\n" +
  "  --urgency is the owner's criterion, RISK-BASED: weigh what goes wrong\n" +
  "  if the owner is not told against a get-that-out-of-the-way, and when close, surface. Every kind but none adds a note:\n" +
  "    breaking      something may break while the owner's act can still change it — needs --breaks, --by, --note-what\n" +
  "    blocked-send  a send the owner approved is stopped on a step only the owner can take (a sign-in), even when low\n" +
  "                  priority — needs --send, --note-what\n" +
  "    fleet-idle    seats sit idle until the owner answers — needs --note-what\n" +
  "    keen          the owner is keen to see this — needs --note-what\n" +
  "    close-call    silence risks something comparable to the cost of telling — needs --if-silent, --note-what\n" +
  "    none          silence risks nothing bad and the owner has not asked to see it: Queue only; park the thread,\n" +
  "                  take steered work\n" +
  "  A note kind also prints the checked `hand post` line: send THAT one line to the pinned supervisor.\n" +
  "  --tried, --doc and --evidence repeat. --options is two to four `<what the owner could do> :: <cost>` lines.";
