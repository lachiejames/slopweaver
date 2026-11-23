/**
 * Flag specs, usage text and the shared parse for the `sweep` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../autonomy/core.ts` and `../knowledge/core.ts` do.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `sweep`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

/*
 * Each verb's flag names are declared as their own arrays and the `FlagSpec` is built FROM them, rather than
 * the FlagSpec being the declaration and the names being read back out of its optional fields. Reading them
 * back needs a `??` per field for a shape that is never actually absent, which `no-silent-fallback` refuses.
 */

const BOARD_STRINGS = ["verdict", "priority", "dir", "home", "base", "deadline"] as const;
const BOARD_BOOLEANS = ["json", "probe", "write", "queue", "settle-ended", "close-shipped"] as const;
const BOARD_FLAGS: FlagSpec = { boolean: BOARD_BOOLEANS, string: BOARD_STRINGS };

const APPLY_STRINGS = ["why", "reason", "anchor", "session", "dir", "home", "now"] as const;
const APPLY_BOOLEANS = ["json"] as const;
const APPLY_FLAGS: FlagSpec = { boolean: APPLY_BOOLEANS, string: APPLY_STRINGS };

const LIST_STRINGS = ["slug", "home"] as const;
const LIST_BOOLEANS = ["json"] as const;
const LIST_FLAGS: FlagSpec = { boolean: LIST_BOOLEANS, string: LIST_STRINGS };

const RECHECK_STRINGS = ["limit", "dir", "home"] as const;
const RECHECK_BOOLEANS = ["json"] as const;
const RECHECK_FLAGS: FlagSpec = { boolean: RECHECK_BOOLEANS, string: RECHECK_STRINGS };

/** Every `--`-prefixed flag one verb accepts, sorted, for the help-truth ratchet. */
function flagNames({
  strings,
  booleans,
}: {
  strings: readonly string[];
  booleans: readonly string[];
}): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed board flags, for the help-truth ratchet. */
export const SWEEP_BOARD_FLAG_NAMES: readonly string[] = flagNames({
  booleans: BOARD_BOOLEANS,
  strings: BOARD_STRINGS,
});

/** `--`-prefixed apply flags, for the help-truth ratchet. */
export const SWEEP_APPLY_FLAG_NAMES: readonly string[] = flagNames({
  booleans: APPLY_BOOLEANS,
  strings: APPLY_STRINGS,
});

/** `--`-prefixed list flags, for the help-truth ratchet. */
export const SWEEP_LIST_FLAG_NAMES: readonly string[] = flagNames({
  booleans: LIST_BOOLEANS,
  strings: LIST_STRINGS,
});

/** `--`-prefixed recheck flags, for the help-truth ratchet. */
export const SWEEP_RECHECK_FLAG_NAMES: readonly string[] = flagNames({
  booleans: RECHECK_BOOLEANS,
  strings: RECHECK_STRINGS,
});

/**
 * Parse `sweep recheck`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseSweepRecheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECHECK_FLAGS });
}

/**
 * Parse `sweep board`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseSweepBoardArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: BOARD_FLAGS });
}

/**
 * Parse `sweep apply`'s flags. The row's slug is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseSweepApplyArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: APPLY_FLAGS });
}

/**
 * Parse `sweep list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseSweepListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/** What `sweep board --help` prints. */
export const BOARD_USAGE =
  "usage: slopweaver sweep board [--verdict <name>] [--priority <p>] [--probe] \\\n" +
  "         [--base <branch>] [--deadline <seconds>] [--dir <path>] [--home <dir>] [--json]\n" +
  "         [--write [--queue] [--settle-ended] [--close-shipped]]\n" +
  "\n" +
  "Classifies every live board row against the evidence it carries, and DELETES NOTHING unless\n" +
  "--settle-ended, --close-shipped or --queue acts. Pure code, no model, no tokens: it re-runs each\n" +
  "row's own doneWhen probes and reads its\n" +
  "run journal, exactly as `handover list` does, reads GitHub for each pull request a live ask's question\n" +
  "names, then says which rows no longer earn their keep and WHY.\n" +
  "\n" +
  "  CONTRADICTED  declared done, but its own state disagrees — REPORTED, never acted on\n" +
  "  SHIPPED       the work is in: a closed journal event, or every declared probe now passing\n" +
  "  PR_ENDED      a live ask nobody is on whose whole question asks to close, merge, land or abandon\n" +
  "                pull requests GitHub reports merged or closed; one or more still open keeps the row\n" +
  "  UNCARDED      a CLOSED ask of their delivered a page that never reached their Queue — no question naming\n" +
  "                it, no ruling, no hand step, no other row's card. The one verdict over closed rows\n" +
  "  ORPHANED      blockedBy reaches a prerequisite that is terminal and unshipped — it can never run\n" +
  "  SUPERSEDED    a newer live row DECLARES this slug superseded — a mention is never enough\n" +
  "  OVERTAKEN     a row matching this top-up's slug and batch brief has a later slug epoch, which proves\n" +
  "                neither who made it nor a replacement — REPORTED, never acted on: a person reads it\n" +
  "  UNWITNESSED   declares no probe, so nothing here can check it. NEVER an act — a row is never swept\n" +
  "                for being merely old; it needs a witness or a detective\n" +
  "\n" +
  "  --probe    run each row's `command:` probes too (slower, and what makes SHIPPED trustworthy)\n" +
  "  --verdict  only rows with this verdict\n" +
  "  --priority only rows at this priority — `--priority p0` selects the p0 cohort\n" +
  "  --json     one JSON object per line, in the same order\n" +
  "  --write    also replace $SLOPWEAVER_HOME/live/hygiene/sweep-board.jsonl with exactly the --json lines\n" +
  "             (zero bytes is a clean pass) and sweep-board-census.json beside it with the verdict census.\n" +
  "             Local only — nothing else is written, unless --queue\n" +
  "  --queue    with --write: once both documents are written, register ONE Queue card per UTC day\n" +
  "             (sweep-board-YYYY-MM-DD) naming each UNCARDED page and the row that delivered it; nothing on a\n" +
  "             clean pass, and nothing when today's card is already on the board. Then it settles the sweep's\n" +
  "             own earlier cards `--as answered`: all of them on a clean pass, earlier days' once today's is in\n" +
  "  --settle-ended  with --write: settle each PR_ENDED row `--as answered` on GitHub's own record, one\n" +
  "             at a time, at most 25 a pass, re-judged at the write, journalled in the sweep ledger and the\n" +
  "             autonomy ledger; it stops at the first failure, then publishes the board after its acts\n" +
  "  --close-shipped  with --write: close each SHIPPED row with `handover close`, never carding it, one at\n" +
  "             a time, at most 25 a pass, left when its run is active or waiting on the owner under the close's\n" +
  "             lock, journalled in both ledgers; a refused close leaves that row and the pass moves on";

/** What `sweep apply --help` prints. */
export const APPLY_USAGE =
  "usage: slopweaver sweep apply <slug> --session <text> [--why <text>] \\\n" +
  '         [--reason "<their words>" --anchor "<where they said it>"] \\\n' +
  "         [--dir <path>] [--home <dir>] [--now <iso>] [--json]\n" +
  "\n" +
  "Performs ONE row's act by running the REGISTER'S OWN verb — `handover close` for SHIPPED,\n" +
  "`handover settle --as declined` for ORPHANED and SUPERSEDED, `handover settle --as answered` on\n" +
  "GitHub's record for PR_ENDED — then journals what it did. Nothing here\n" +
  "edits a `status:` line: a row's state is derived, so an edit would change nothing\n" +
  "any reader consults.\n" +
  "\n" +
  "A decline is the OWNER's alone, so ORPHANED and SUPERSEDED need their words (--reason) and the anchor to\n" +
  "where they gave them (--anchor), and are refused before anything runs without both. The sweep never\n" +
  "writes either for them: its witness is the evidence, and stays the ledger's witness.\n" +
  "\n" +
  "One row at a time and never a batch: a wrong verdict applied to one row is a correction, and applied to\n" +
  "a cohort it is an incident. The underlying verb's refusals stand — a second close, or a settle on a row\n" +
  "that is not an ask, comes back refused and the row is untouched.\n" +
  "\n" +
  "Refuses a row whose verdict carries no act. CONTRADICTED, OVERTAKEN, UNWITNESSED and KEEP are all\n" +
  "unactable: a contradiction is a finding for a session to investigate, not something a verb can make\n" +
  "true, and an overtaken row is a person's to read before anyone settles it.\n" +
  "\n" +
  "  --session  which session is acting, recorded on the ledger row\n" +
  "  --why      anything the witness does not already say\n" +
  "  --reason   ORPHANED/SUPERSEDED only: the owner's own words for declining the row\n" +
  "  --anchor   ORPHANED/SUPERSEDED only: where they said them — the settle's witness";

/** What `sweep recheck --help` prints. */
export const RECHECK_USAGE =
  "usage: slopweaver sweep recheck [--limit <n>] [--dir <path>] [--home <dir>] [--json]\n" +
  "\n" +
  "Lists the Queue cards the morning seat reads against later evidence: asks waiting on the owner that nobody\n" +
  "is on and nobody verified this UTC day, by priority, then least recently verified. Age orders the list and\n" +
  "is never evidence. No network, no model, nothing written; a partial board refuses.\n" +
  "\n" +
  "  --limit  the most cards to print, 5 by default\n" +
  "  --json   one JSON object per line, in the same order";

/** What `sweep list --help` prints. */
export const LIST_USAGE =
  "usage: slopweaver sweep list [--slug <slug>] [--home <dir>] [--json]\n" +
  "\n" +
  "Reads the sweep ledger — every act performed, the verdict and witness that chose it, and the exact\n" +
  "register verb line it ran. This is the RAIL: what the sweep took stays findable. No network, no model.\n" +
  "\n" +
  "  --json  one JSON object per line, in the same order";

/**
 * One flag's string value, or nothing when the caller did not supply it.
 *
 * Shared by all four verbs so the four of them cannot disagree about what "not supplied" is.
 *
 * @param values the parser's flag map
 * @param name the flag, without its dashes
 * @returns the value, or undefined
 */
export function flag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}
