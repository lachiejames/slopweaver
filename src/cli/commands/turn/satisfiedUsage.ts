/**
 * The `turn satisfied` verb's usage text and flag spec — a LEAF, importing nothing.
 *
 * Its own module for the reason `../../../.claude/rules/area-cli.md` names: a manifest that reaches into
 * `./core.ts` for a usage string drags `core.ts`'s whole dependency tree — `node:fs`, the mention surface,
 * the supervisor session vocabulary — onto every enumeration of the verb surface. `../listen/listenUsage.ts`
 * is the shape this copies. Both constants are read twice, by the parser and by the `--help`-truth ratchet,
 * so they live where neither reader pulls anything else in.
 */

/** What `slopweaver turn satisfied --help` prints, and what the `--help`-truth ratchet reads. */
export const TURN_SATISFIED_USAGE =
  "usage: slopweaver turn satisfied --channel <id> --message-ts <ts> --answered-by-ts <ts> --reason <text>\n" +
  "                          [--home <dir>]\n" +
  "  Settles one ask whose content ANOTHER message already answers — another turn's answer, or the top-level\n" +
  "  `finding` posts a scheduled hunt made in the same DM: retracts every card this ask\n" +
  "  posted, settles its reaction to :white_check_mark:, records a pointer to the answer — and POSTS\n" +
  "  NOTHING. The terminal for a thread that is already finished to the person reading it. Runs no model\n" +
  "  and never touches the corpus. Idempotent: a second pass over a settled ask writes nothing and exits 3.\n" +
  "  --message-ts     the addressing message's OWN ts — the same exact identity every other turn verb keys on.\n" +
  "  --answered-by-ts the ts of the message that already answers it. REFUSED when it names this ask's own\n" +
  "                   message, or a card this ask itself posted — neither is an answer.\n" +
  "  --reason         why that answer satisfies this ask, in your own words — recorded, never inferred.\n" +
  "  Exits 1 and writes NOTHING when a card could not be deleted, so the ask stays non-terminal and a later\n" +
  "  pass retries. NOT a permanent ignore (`turn ignore`) and NOT a no-response triage: both of those say\n" +
  "  nothing was answered, and this one says it was.";

/** The `satisfied` verb's flag SPEC, exported for the same ratchet. */
export const TURN_SATISFIED_FLAG_SPEC = {
  boolean: [] as readonly string[],
  string: ["channel", "message-ts", "answered-by-ts", "reason", "home"],
} as const;
